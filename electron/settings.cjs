'use strict';

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULTS = {
  /** 'zh' | 'en' */
  language: 'zh',
  /** send an anonymous launch beacon (random device id only) */
  telemetry: true,
  /** check for a new release on launch (at most one dialog per day) */
  autoCheckUpdates: true,
  /** internal: last UTC date a update dialog was shown */
  lastUpdateNotice: '',
  /** absolute path of the notes library; empty means "detect on first launch" */
  vaultPath: '',
  /** 'light' | 'dark' */
  theme: 'light',
  /** editor font size in px */
  fontSize: 15,
  /** autosave debounce in ms */
  autoSaveDelay: 700,
  /** quit the app when the last window closes (macOS default is to stay) */
  quitOnAllWindowsClosed: false,
  /** re-open the last edited note on launch */
  restoreLastNote: true,
  /** 'mtime' | 'ctime' | 'title' */
  sortBy: 'mtime',
  /** show a two-line preview under each title */
  showSnippet: true,
  /** 'edit' | 'preview' | 'split' — how a note opens */
  defaultView: 'edit',
  /** disable the cat float animation and other transitions */
  reduceMotion: false,
  /** last window geometry; null means "let macOS place it" */
  windowBounds: null,
  /** window was zoomed on quit, so reopen zoomed */
  windowMaximized: false,
  /** window was fullscreen on quit, so reopen fullscreen */
  windowFullScreen: false,
};

const VIEW_MODES = ['edit', 'preview', 'split'];

const MIN_BOUND = { width: 480, height: 320 };
const MAX_BOUND = 10000;

/** Keep only numbers we could actually hand back to BrowserWindow. */
function sanitizeBounds(input) {
  if (!input || typeof input !== 'object') return null;

  const numbers = [input.x, input.y, input.width, input.height].map(Number);
  if (!numbers.every((value) => Number.isFinite(value))) return null;

  const [x, y, width, height] = numbers.map((value) => Math.round(value));
  if (width < MIN_BOUND.width || height < MIN_BOUND.height) return null;
  if (width > MAX_BOUND || height > MAX_BOUND) return null;
  return { x, y, width, height };
}

let cache = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function sanitize(input) {
  const out = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return out;

  if (input.language === 'zh' || input.language === 'en') out.language = input.language;
  if (typeof input.telemetry === 'boolean') out.telemetry = input.telemetry;
  if (typeof input.autoCheckUpdates === 'boolean') {
    out.autoCheckUpdates = input.autoCheckUpdates;
  }
  if (typeof input.lastUpdateNotice === 'string') {
    out.lastUpdateNotice = input.lastUpdateNotice;
  }
  if (typeof input.vaultPath === 'string') out.vaultPath = input.vaultPath;
  if (input.theme === 'light' || input.theme === 'dark') out.theme = input.theme;

  const size = Number(input.fontSize);
  if (Number.isFinite(size)) out.fontSize = Math.min(22, Math.max(12, Math.round(size)));

  const delay = Number(input.autoSaveDelay);
  if (Number.isFinite(delay)) out.autoSaveDelay = Math.min(3000, Math.max(200, Math.round(delay)));

  if (typeof input.quitOnAllWindowsClosed === 'boolean') {
    out.quitOnAllWindowsClosed = input.quitOnAllWindowsClosed;
  }
  if (typeof input.restoreLastNote === 'boolean') out.restoreLastNote = input.restoreLastNote;

  if (['mtime', 'ctime', 'title'].includes(input.sortBy)) out.sortBy = input.sortBy;
  if (typeof input.showSnippet === 'boolean') out.showSnippet = input.showSnippet;
  if (VIEW_MODES.includes(input.defaultView)) {
    out.defaultView = input.defaultView;
  } else if (typeof input.defaultPreview === 'boolean') {
    // 1.x stored a bare boolean: true meant "open in preview"
    out.defaultView = input.defaultPreview ? 'preview' : 'edit';
  }
  if (typeof input.reduceMotion === 'boolean') out.reduceMotion = input.reduceMotion;

  out.windowBounds = sanitizeBounds(input.windowBounds);
  if (typeof input.windowMaximized === 'boolean') out.windowMaximized = input.windowMaximized;
  if (typeof input.windowFullScreen === 'boolean') out.windowFullScreen = input.windowFullScreen;

  return out;
}

function read() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    cache = sanitize(raw);
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function write(patch) {
  const next = sanitize({ ...read(), ...patch });
  cache = next;
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    console.error('[settings] failed to persist:', error);
  }
  return next;
}

function reset() {
  cache = { ...DEFAULTS };
  try {
    fs.rmSync(settingsFile(), { force: true });
  } catch {
    /* ignore */
  }
  return cache;
}

module.exports = { read, write, reset, DEFAULTS };
