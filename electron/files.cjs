'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { findConflictCopies, isPlaceholder, placeholderTarget } = require('./icloud.cjs');

const IGNORED_DIRS = new Set(['.git', '.obsidian', '.trash', '.DS_Store', 'node_modules']);
const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdown', '.txt']);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

class PathError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function safeResolve(vault, relative) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new PathError('path is required');
  }
  if (relative.includes('\0')) {
    throw new PathError('invalid path');
  }
  const normalized = path.normalize(relative).replace(/^([/\\])+/, '');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new PathError('path escapes vault');
  }
  const root = path.resolve(vault);
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new PathError('path escapes vault');
  }
  return target;
}

async function statOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isMarkdown(name) {
  return MARKDOWN_EXT.has(path.extname(name).toLowerCase());
}

async function readTree(root, relative = '', depth = 0) {
  if (depth > 12) return [];
  const dir = relative ? path.join(root, relative) : root;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !isPlaceholder(entry.name)) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const rel = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: rel,
        type: 'dir',
        children: await readTree(root, rel, depth + 1),
      });
      continue;
    }

    if (!entry.isFile()) continue;

    // An iCloud placeholder is a real note that simply isn't downloaded yet.
    if (isPlaceholder(entry.name)) {
      const name = placeholderTarget(entry.name);
      nodes.push({
        name,
        path: relative ? `${relative}/${name}` : name,
        type: 'file',
        size: 0,
        mtime: 0,
        pending: true,
      });
      continue;
    }

    if (!isMarkdown(entry.name)) continue;
    const info = await statOrNull(path.join(dir, entry.name));
    nodes.push({
      name: entry.name,
      path: rel,
      type: 'file',
      size: info?.size ?? 0,
      mtime: info?.mtimeMs ?? 0,
    });
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return nodes;
}

async function atomicWrite(target, content) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, target);
}

/**
 * Read the first few hundred bytes to derive a list title and snippet.
 * Avoids loading a whole vault into memory just to render the middle column.
 */
async function readHead(file, fileName) {
  const fallbackTitle = fileName.replace(/\.(md|markdown|mdown|txt)$/i, '');
  try {
    const handle = await fs.open(file, 'r');
    const buffer = Buffer.alloc(700);
    const { bytesRead } = await handle.read(buffer, 0, 700, 0);
    await handle.close();

    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');

    let title = fallbackTitle;
    const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
    if (heading) {
      title = heading.replace(/^#{1,6}\s+/, '').trim() || fallbackTitle;
    }

    const body = lines
      .filter((line) => line.trim() && !/^#{1,6}\s+/.test(line) && !/^---\s*$/.test(line))
      .join(' ')
      .replace(/[*`>#[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { title, snippet: body.slice(0, 110) };
  } catch {
    return { title: fallbackTitle, snippet: '' };
  }
}

function createFileService(vault) {
  const root = path.resolve(vault);

  return {
    root,

    async ensure() {
      await fs.mkdir(root, { recursive: true });
    },

    async tree() {
      return readTree(root);
    },

    /**
     * Flat list with a short snippet, used by the middle column.
     * Reads only the head of each file so a large vault stays fast.
     */
    async list() {
      const out = [];

      const walk = async (relative) => {
        const dir = relative ? path.join(root, relative) : root;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
          const rel = relative ? `${relative}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await walk(rel);
            continue;
          }
          if (!entry.isFile() || !isMarkdown(entry.name)) continue;

          const file = path.join(dir, entry.name);
          const info = await statOrNull(file);
          if (!info) continue;

          const { title, snippet } = await readHead(file, entry.name);
          out.push({
            path: rel,
            name: entry.name,
            folder: relative,
            title,
            snippet,
            mtime: info.mtimeMs,
            ctime: info.birthtimeMs || info.mtimeMs,
            size: info.size,
          });
        }
      };

      await walk('');
      out.sort((a, b) => b.mtime - a.mtime);
      return out;
    },

    async read(relative) {
      const target = safeResolve(root, relative);
      const info = await statOrNull(target);
      if (!info) {
        const error = new Error('note not found');
        error.status = 404;
        throw error;
      }
      if (info.size > MAX_FILE_BYTES) {
        const error = new Error('note is too large');
        error.status = 413;
        throw error;
      }
      const content = await fs.readFile(target, 'utf8');
      const conflicts = findConflictCopies(path.dirname(target), path.basename(target)).map(
        (file) => path.basename(file),
      );
      return { path: relative, content, mtime: info.mtimeMs, size: info.size, conflicts };
    },

    async write(relative, content) {
      const target = safeResolve(root, relative);
      if (!isMarkdown(path.basename(target))) {
        throw new PathError('only markdown notes are writable');
      }
      // Check before writing so the UI can warn about iCloud conflict copies.
      const conflicts = findConflictCopies(path.dirname(target), path.basename(target)).map(
        (file) => path.basename(file),
      );
      await atomicWrite(target, content);
      const info = await fs.stat(target);
      return { path: relative, mtime: info.mtimeMs, size: info.size, conflicts };
    },

    async create(relative, content = '') {
      const target = safeResolve(root, relative);
      if (await statOrNull(target)) {
        const error = new Error('note already exists');
        error.status = 409;
        throw error;
      }
      if (!isMarkdown(path.basename(target))) {
        throw new PathError('only markdown notes are supported');
      }
      await atomicWrite(target, content);
      return { path: relative };
    },

    async mkdir(relative) {
      const target = safeResolve(root, relative);
      await fs.mkdir(target, { recursive: true });
      return { path: relative };
    },

    async remove(relative) {
      const target = safeResolve(root, relative);
      if (target === root) throw new PathError('cannot remove the vault root');
      const trash = path.join(root, '.trash', String(Date.now()));
      await fs.mkdir(trash, { recursive: true });
      await fs.rename(target, path.join(trash, path.basename(target)));
      return { path: relative, trashed: true };
    },

    async rename(from, to) {
      const source = safeResolve(root, from);
      const target = safeResolve(root, to);
      if (await statOrNull(target)) {
        const error = new Error('target already exists');
        error.status = 409;
        throw error;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target);
      return { from, to };
    },

    async search(query, limit = 80) {
      const needle = String(query || '').trim();
      if (!needle) return [];
      const lower = needle.toLowerCase();
      const results = [];

      const walk = async (relative) => {
        if (results.length >= limit) return;
        const dir = relative ? path.join(root, relative) : root;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= limit) return;
          if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
          const rel = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(rel);
            continue;
          }
          if (!entry.isFile() || !isMarkdown(entry.name)) continue;

          const file = path.join(dir, entry.name);
          const info = await statOrNull(file);
          if (!info || info.size > MAX_FILE_BYTES) continue;

          const text = await fs.readFile(file, 'utf8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].toLowerCase().includes(lower)) {
              results.push({
                path: rel,
                name: entry.name,
                line: i + 1,
                text: lines[i].slice(0, 160).trim(),
              });
              if (results.length >= limit) return;
            }
          }
        }
      };

      await walk('');
      return results;
    },

    vaultPath: () => root,
  };
}

module.exports = { createFileService, safeResolve, PathError };
