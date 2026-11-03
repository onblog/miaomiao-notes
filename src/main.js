import 'katex/dist/katex.min.css';
import './styles/app.css';
import { createEditor } from './editor.js';
import { renderMarkdown, renderMermaid } from './preview.js';
import { createMockApi } from './mock-api.js';
import { loadScroll, saveScroll } from './scroll-memory.js';
import { t, setLanguage, getLanguage, applyI18n } from './i18n.js';

// In a plain browser (Vite dev without Electron) fall back to in-memory data
// so the UI can be iterated on without the desktop shell.
const api = window.miaomiao ?? (import.meta.env.DEV ? createMockApi() : null);

const state = {
  settings: null,
  appVersion: '',
  vaultPath: '',
  vault: null,
  notes: [],
  folders: [],
  activeFolder: '',
  activeNote: null,
  currentMtime: 0,
  query: '',
  dirty: false,
  saving: false,
  viewMode: 'edit',
  sidebarCollapsed: false,
  saveTimer: null,
  // 行内改名：正在编辑的笔记路径 + 就地校验提示的 i18n key
  renaming: null,
  renameError: '',
};

const el = {
  folderNav: document.getElementById('folder-nav'),
  noteList: document.getElementById('note-list'),
  notesTitle: document.getElementById('notes-title'),
  search: document.getElementById('search-input'),
  app: document.getElementById('app'),
  notesPane: document.getElementById('notes-pane'),
  listResizer: document.getElementById('list-resizer'),
  sidebarToggle: document.getElementById('btn-toggle-sidebar'),
  content: document.getElementById('content'),
  viewButton: document.getElementById('btn-preview'),
  editorHost: document.getElementById('editor-host'),
  previewHost: document.getElementById('preview-host'),
  contentHeader: document.getElementById('content-header'),
  titleInput: document.getElementById('title-input'),
  contentDate: document.getElementById('content-date'),
  emptyState: document.getElementById('empty-state'),
  conflictBanner: document.getElementById('conflict-banner'),
  syncHint: document.getElementById('sync-hint'),
  langToggle: document.getElementById('btn-lang'),
  themeToggle: document.getElementById('btn-theme'),
};

const SCROLL_SAVE_DELAY = 400;
let scrollTimer = null;

/** 记住「这篇笔记读到哪」。滚动事件很密，落点后节流一次就够。 */
function rememberScroll() {
  if (!state.activeNote) return;
  saveScroll(state.activeNote, editor.captureScroll());
}

function scheduleScrollSave() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(rememberScroll, SCROLL_SAVE_DELAY);
}

/** 关窗口 / 切到后台时把最后的位置补一次，节流里的那次未必来得及跑。 */
function flushScroll() {
  clearTimeout(scrollTimer);
  rememberScroll();
}

window.addEventListener('beforeunload', flushScroll);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushScroll();
});

const editor = createEditor({
  parent: el.editorHost,
  onChange: onDocChange,
  onPasteImage: handleImageFiles,
  onScroll: scheduleScrollSave,
});

/* ---------------------------------------------------------------- helpers */

function toast(message, isError = false) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast${isError ? ' is-error' : ''}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}

function relativeTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return t('time.justNow');
  if (diff < hour) return t('time.minutes', { n: Math.floor(diff / minute) });
  if (diff < day) return t('time.hours', { n: Math.floor(diff / hour) });
  if (diff < 7 * day) return t('time.days', { n: Math.floor(diff / day) });

  const date = new Date(ms);
  return t('time.date', { m: date.getMonth() + 1, d: date.getDate() });
}

function formatDate(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');

  if (getLanguage() === 'en') {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function stemOf(name) {
  return name.replace(/\.(md|markdown|mdown|txt)$/i, '');
}

function folderOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/* ---------------------------------------------------------------- modal */

function askInput({ title, value = '', placeholder = '', confirmLabel = t('dialog.confirm') }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2 class="modal__title"></h2>
        <input class="modal__input" type="text" spellcheck="false" />
        <div class="modal__actions">
          <button class="modal__cancel" type="button">取消</button>
          <button class="modal__confirm" type="button"></button>
        </div>
      </div>
    `;

    const titleNode = backdrop.querySelector('.modal__title');
    const input = backdrop.querySelector('.modal__input');
    const confirm = backdrop.querySelector('.modal__confirm');

    titleNode.textContent = title;
    input.value = value;
    input.placeholder = placeholder;
    confirm.textContent = confirmLabel;

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const submit = () => {
      const next = input.value.trim();
      if (!next) return;
      close(next);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Enter') submit();
    };

    backdrop.querySelector('.modal__cancel').addEventListener('click', () => close(null));
    confirm.addEventListener('click', submit);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  });
}

/** 自绘确认框：替代原生 dialog.showMessageBox（M7 不接受原生控件，也避免原生菜单连锁崩溃）。 */
function askConfirm({
  title,
  message,
  detail = '',
  confirmLabel = t('action.confirm'),
  danger = false,
}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2 class="modal__title"></h2>
        <p class="modal__message"></p>
        <p class="modal__detail"></p>
        <div class="modal__actions">
          <button class="modal__cancel" type="button"></button>
          <button class="modal__confirm" type="button"></button>
        </div>
      </div>
    `;

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    };

    backdrop.querySelector('.modal__title').textContent = title;
    backdrop.querySelector('.modal__message').textContent = message;
    const detailNode = backdrop.querySelector('.modal__detail');
    detailNode.textContent = detail;
    detailNode.hidden = !detail;

    const cancel = backdrop.querySelector('.modal__cancel');
    const confirm = backdrop.querySelector('.modal__confirm');
    cancel.textContent = t('action.cancel');
    confirm.textContent = confirmLabel;
    confirm.classList.toggle('is-danger', danger);

    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    confirm.focus();
  });
}

/* -------------------------------------------------------------- 重命名 */

/* 唯一的改名入口：笔记列表的行内编辑框（双击行标题、选中后按 Enter、
   右键菜单「重命名」、点内容区顶部标题，走的都是这一个 startRename）。 */

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g;

function sanitizeNoteName(raw) {
  return String(raw ?? '').replace(ILLEGAL_NAME_CHARS, '').trim();
}

function renameTargetPath(path, name) {
  const folder = folderOf(path);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

function startRename(path) {
  if (!path) return;
  state.renaming = path;
  state.renameError = '';
  renderNotes();
}

function stopRename() {
  state.renaming = null;
  state.renameError = '';
  renderNotes();
}

/**
 * 真正落盘的一步：先 flushSave，否则防抖保存会在改名之后写回旧路径，
 * 凭空多出一个同内容的旧文件。
 */
async function renameNote(path, name) {
  const target = renameTargetPath(path, name);
  const taken = state.notes.some(
    (note) => note.path !== path && note.path.toLowerCase() === target.toLowerCase(),
  );
  if (taken) return { ok: false, error: 'rename.exists' };

  await flushSave();
  const result = await api.notes.rename(path, target);
  if (!result.ok) {
    toast(result.error || t('toast.renameFailed'), true);
    return { ok: false, fatal: true };
  }

  // 就地更新，不做整库重读：列表标题现在就是文件名，改完立刻可见。
  const moved = state.notes.find((note) => note.path === path);
  if (moved) {
    moved.path = target;
    moved.name = `${name}.md`;
    moved.title = name;
  }
  if (state.activeNote === path) {
    // 「读到哪」是按路径存的，改名得把锚点搬到新 key 上
    const anchor = loadScroll(path);
    state.activeNote = target;
    if (anchor != null) saveScroll(target, anchor);
    el.titleInput.value = name;
  }

  state.renaming = null;
  state.renameError = '';
  renderNotes();
  return { ok: true };
}

/** 行内输入框：Enter 提交、Esc 取消、失焦提交；校验失败就留在编辑态并就地提示。 */
function createRenameInput(note, errorNode) {
  const input = document.createElement('input');
  input.className = 'note-item__rename';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.value = stemOf(note.name);
  input.setAttribute('aria-label', t('action.rename'));

  let settled = false;

  const fail = (key) => {
    state.renameError = key;
    errorNode.hidden = false;
    errorNode.textContent = t(key);
    input.classList.add('is-invalid');
    input.focus();
    input.select();
  };

  const commit = async () => {
    if (settled) return;
    const next = sanitizeNoteName(input.value);
    if (!next) {
      fail('rename.empty');
      return;
    }
    if (next === stemOf(note.name)) {
      settled = true;
      stopRename();
      return;
    }

    settled = true;
    input.disabled = true;
    const result = await renameNote(note.path, next);
    if (result.ok) return;
    if (result.fatal) {
      stopRename();
      return;
    }
    settled = false;
    input.disabled = false;
    fail(result.error);
  };

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      stopRename();
    }
  });
  input.addEventListener('blur', () => void commit());
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  return input;
}

/* ---------------------------------------------------------- 自绘右键菜单 */

let activeMenu = null;

function closeNoteMenu() {
  if (!activeMenu) return;
  const { node, onPointerDown, onKeyDown } = activeMenu;
  node.remove();
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('resize', closeNoteMenu);
  window.removeEventListener('blur', closeNoteMenu);
  activeMenu = null;
}

/**
 * 笔记行的右键菜单。以前是主进程的 `Menu.popup`：原生控件（M7 不接受），
 * 而且菜单对象在回调之后会被 GC、AppKit 还在用它 —— 崩溃栈就是向已释放对象发消息。
 */
function showNoteMenu(path, x, y) {
  closeNoteMenu();

  const node = document.createElement('div');
  node.className = 'context-menu';
  node.setAttribute('role', 'menu');

  const entries = [
    { label: t('action.rename'), run: () => startRename(path) },
    { label: t('action.reveal'), run: () => api.notes.reveal(path) },
    { label: t('action.delete'), danger: true, run: () => deleteNote(path) },
  ];

  for (const entry of entries) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `context-menu__item${entry.danger ? ' is-danger' : ''}`;
    item.setAttribute('role', 'menuitem');
    item.textContent = entry.label;
    item.addEventListener('click', () => {
      closeNoteMenu();
      entry.run();
    });
    node.appendChild(item);
  }

  document.body.appendChild(node);

  const rect = node.getBoundingClientRect();
  node.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  node.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;

  const onPointerDown = (event) => {
    if (!node.contains(event.target)) closeNoteMenu();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeNoteMenu();
    }
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', closeNoteMenu);
  window.addEventListener('blur', closeNoteMenu);
  activeMenu = { node, onPointerDown, onKeyDown };

  node.querySelector('button')?.focus();
}

/* ---------------------------------------------------------------- render */

/**
 * Sidebar shows only the folders directly under the vault root — nested ones
 * stay reachable through the notes they contain, not as extra sidebar rows.
 * Empty top-level folders are included because the tree already lists them.
 */
function collectFolderPaths(nodes) {
  return nodes
    .filter((node) => node.type === 'dir')
    .map((node) => node.path)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function renderFolders() {
  const items = [{ name: t('list.all'), path: '' }, ...state.folders.map((path) => ({ name: path, path }))];

  el.folderNav.replaceChildren();
  for (const item of items) {
    const count =
      item.path === ''
        ? state.notes.length
        : state.notes.filter((note) => note.folder === item.path || note.folder.startsWith(`${item.path}/`)).length;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `folder-item${state.activeFolder === item.path ? ' is-active' : ''}`;
    button.dataset.path = item.path;

    button.innerHTML = `
      <svg class="folder-item__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h5l2 2h9v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
      </svg>
      <span class="folder-item__name"></span>
      <span class="folder-item__count"></span>
    `;
    button.querySelector('.folder-item__name').textContent = item.name.split('/').pop();
    button.querySelector('.folder-item__count').textContent = String(count);
    button.addEventListener('click', () => {
      state.activeFolder = item.path;
      renderFolders();
      renderNotes();
      el.notesTitle.textContent = item.path ? item.path.split('/').pop() : t('list.all');
    });
    el.folderNav.appendChild(button);
  }
}

function sortNotes(notes) {
  const mode = state.settings?.sortBy ?? 'mtime';
  const sorted = [...notes];
  if (mode === 'title') {
    sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'));
  } else if (mode === 'ctime') {
    sorted.sort((a, b) => (b.ctime || 0) - (a.ctime || 0));
  } else {
    sorted.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  }
  return sorted;
}

function visibleNotes() {
  let notes = state.notes;
  if (state.activeFolder) {
    notes = notes.filter(
      (note) => note.folder === state.activeFolder || note.folder.startsWith(`${state.activeFolder}/`),
    );
  }
  if (state.query) {
    const lower = state.query.toLowerCase();
    notes = notes.filter(
      (note) =>
        note.title.toLowerCase().includes(lower) ||
        // 标题以文件名为准后，正文里的 heading 不再参与命名，但搜索仍应命中它
        (note.heading || '').toLowerCase().includes(lower) ||
        note.snippet.toLowerCase().includes(lower),
    );
  }
  return sortNotes(notes);
}

function renderNotes() {
  const notes = visibleNotes();
  el.noteList.classList.toggle('hide-snippet', !state.settings?.showSnippet);
  el.noteList.replaceChildren();

  if (!notes.length) {
    const empty = document.createElement('li');
    empty.className = 'list-empty';
    empty.textContent = state.query ? t('list.noResults') : t('list.empty');
    el.noteList.appendChild(empty);
    return;
  }

  for (const note of notes) {
    const renaming = state.renaming === note.path;
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      `note-item${state.activeNote === note.path ? ' is-active' : ''}${renaming ? ' is-renaming' : ''}`;
    button.dataset.path = note.path;

    const title = document.createElement('div');
    title.className = 'note-item__title';
    if (state.activeNote === note.path && state.dirty && !renaming) {
      const dot = document.createElement('span');
      dot.className = 'note-item__dot';
      title.appendChild(dot);
    }

    // 校验失败的提示节点先建出来，输入框提交失败时直接往里写，不重建这一行
    const error = document.createElement('div');
    error.className = 'note-item__rename-error';
    error.hidden = true;

    if (renaming) {
      title.appendChild(createRenameInput(note, error));
    } else {
      const titleText = document.createElement('span');
      titleText.textContent = note.title || stemOf(note.name);
      title.appendChild(titleText);
    }

    const meta = document.createElement('div');
    meta.className = 'note-item__meta';
    const time = document.createElement('span');
    time.textContent = relativeTime(note.mtime);
    meta.appendChild(time);

    const snippet = document.createElement('div');
    snippet.className = 'note-item__snippet';
    snippet.textContent = note.snippet || t('list.blank');

    if (renaming) {
      button.append(title, error, meta);
    } else {
      button.append(title, meta, snippet);
    }
    button.addEventListener('click', () => {
      if (state.renaming === note.path) return;
      void openNote(note.path);
    });
    li.appendChild(button);
    el.noteList.appendChild(li);
  }

  if (state.renaming) {
    const input = el.noteList.querySelector('.note-item__rename');
    if (input) {
      input.focus();
      input.select();
    } else {
      state.renaming = null;
    }
  }
}

function updateSyncHint() {
  if (!state.vault) return;
  const name = state.vault.path.split('/').pop();
  el.syncHint.textContent = state.vault.isICloud
    ? t('sync.icloud', { name })
    : t('sync.local');
}

/* ---------------------------------------------------------------- load */

async function refresh() {
  const [listResult, treeResult] = await Promise.all([api.notes.list(), api.notes.tree()]);
  if (!listResult.ok) {
    toast(listResult.error || t('toast.loadFailed'), true);
    return;
  }

  state.notes = listResult.data;
  if (treeResult.ok) state.folders = collectFolderPaths(treeResult.data);

  renderFolders();
  renderNotes();
}

async function openNote(path) {
  if (path === state.activeNote) return;
  await flushSave();
  // 换篇之前先把当前这篇的阅读位置落盘，否则切走就丢了。
  rememberScroll();

  const result = await api.notes.read(path);
  if (!result.ok) {
    toast(result.error || t('toast.openFailed'), true);
    return;
  }

  state.activeNote = path;
  state.currentMtime = result.data.mtime;
  state.dirty = false;
  try {
    localStorage.setItem('miaomiao:last-note', path);
  } catch {
    /* storage may be unavailable, not fatal */
  }
  editor.reset(result.data.content);

  el.contentHeader.hidden = false;
  el.emptyState.hidden = true;
  el.titleInput.value = stemOf(path.split('/').pop());
  el.contentDate.textContent = t('note.updated', { time: formatDate(result.data.mtime) });
  applyViewMode(state.settings?.defaultView ?? 'edit');
  // 视图可见之后才恢复：预览模式下编辑器尺寸是 0，scrollTop 设不进去。
  editor.restoreScroll(loadScroll(path));
  el.emptyState.hidden = true;

  if (result.data.conflicts?.length) {
    showConflict(result.data.conflicts);
  } else {
    el.conflictBanner.hidden = true;
  }

  renderNotes();
}

/* ---------------------------------------------------------------- save */

/** Read pasted or dropped images, store them next to the note, insert links. */
async function handleImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;

  if (!state.activeNote) {
    toast(t('toast.needNote'), true);
    return;
  }

  let saved = 0;

  for (const file of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const base64 = String(dataUrl).split(',')[1] || '';
    const subtype = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const result = await api.notes.saveImage(state.activeNote, base64, `.${subtype}`);

    if (!result.ok) {
      toast(t('toast.imageFailed'), true);
      continue;
    }

    editor.insertAtCursor(`\n![图片](${result.data})\n`);
    saved += 1;
  }

  if (saved) toast(t('toast.imageSaved'));
}

function noteBaseDir() {
  if (!state.vaultPath || !state.activeNote) return '';
  const cut = state.activeNote.lastIndexOf('/');
  const folder = cut === -1 ? '' : state.activeNote.slice(0, cut);
  return folder ? `${state.vaultPath}/${folder}` : state.vaultPath;
}

/** 把编辑器内容画进预览区；mermaid 图表在这里做二次渲染。 */
function paintPreview() {
  if (state.viewMode === 'edit') return;
  el.previewHost.innerHTML = renderMarkdown(editor.getValue(), noteBaseDir());
  // 内容已整体替换，旧指纹必须作废，否则并发重绘时会误以为「渲染过了」
  delete el.previewHost.dataset.mermaidKey;
  void renderMermaid(el.previewHost, state.settings?.theme === 'dark' ? 'dark' : 'cream');
}

function onDocChange() {
  paintPreview();
  if (!state.activeNote) return;
  state.dirty = true;
  renderNotes();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => save(), state.settings?.autoSaveDelay ?? 700);
}

async function save() {
  if (!state.activeNote || !state.dirty || state.saving) return;
  clearTimeout(state.saveTimer);
  state.saving = true;

  const target = state.activeNote;
  const content = editor.getValue();
  const result = await api.notes.write(target, content);

  state.saving = false;

  if (!result.ok) {
    toast(result.error || t('toast.saveFailed'), true);
    return;
  }

  state.dirty = false;
  state.currentMtime = Date.now();
  const local = state.notes.find((note) => note.path === target);
  if (local) {
    local.mtime = Date.now();
    local.snippet = content
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .join(' ')
      .slice(0, 110);
  }
  renderNotes();

  if (result.data.conflicts?.length) {
    showConflict(result.data.conflicts);
  }
}

async function flushSave() {
  if (state.dirty) {
    clearTimeout(state.saveTimer);
    await save();
  }
}

function showConflict(names) {
  el.conflictBanner.querySelector('span').textContent = `${t('conflict.message')} ${names.join(
    ', ',
  )}`;
  el.conflictBanner.hidden = false;
}

/* ---------------------------------------------------------------- actions */

async function createNote() {
  const folder = state.activeFolder;
  const name = await askInput({
    title: t('dialog.newNote.title'),
    placeholder: t('dialog.newNote.placeholder'),
    value: '',
    confirmLabel: t('action.create'),
  });
  if (!name) return;

  const safe = name.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!safe) return;

  const path = folder ? `${folder}/${safe}.md` : `${safe}.md`;
  const result = await api.notes.create(path, `# ${safe}\n\n`);
  if (!result.ok) {
    toast(result.error || t('toast.createFailed'), true);
    return;
  }

  await refresh();
  await openNote(path);
}

/** Create a folder at the top level, or inside the currently selected folder. */
async function createFolder() {
  const name = await askInput({
    title: t('dialog.newFolder.title'),
    placeholder: t('dialog.newFolder.placeholder'),
    confirmLabel: t('action.create'),
  });
  if (!name) return;

  const clean = name.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!clean) return;

  // Folders are flat: always created at the vault root.
  const result = await api.notes.mkdir(clean);
  if (!result.ok) {
    toast(t('toast.folderFailed'), true);
    return;
  }

  await refresh();
  toast(t('toast.folderCreated'));
}

async function deleteNote(path = state.activeNote) {
  if (!path) return;
  const confirmed = await askConfirm({
    title: t('dialog.delete.title'),
    message: t('dialog.delete.message', { name: stemOf(path.split('/').pop()) }),
    detail: t('dialog.delete.detail'),
    confirmLabel: t('action.delete'),
    danger: true,
  });
  if (!confirmed) return;

  const result = await api.notes.remove(path);
  if (!result.ok) {
    toast(result.error || t('toast.deleteFailed'), true);
    return;
  }

  if (path === state.activeNote) {
    state.activeNote = null;
    state.dirty = false;
    editor.reset('');
    el.contentHeader.hidden = true;
    el.editorHost.hidden = true;
    el.emptyState.hidden = false;
  }
  if (state.renaming === path) {
    state.renaming = null;
    state.renameError = '';
  }
  await refresh();
}

/**
 * 视图三态循环：只写 → 全屏预览 → 边写边读 → 只写。
 * 一个按钮承担三态，图标与提示语跟随当前状态（见 styles/app.css 的 .view-toggle）。
 */
const VIEW_ORDER = ['edit', 'preview', 'split'];

/**
 * 正文字体候选：全部是 macOS 自带、可直接用 CSS 命中的经典字体，
 * 具体字体栈定义在 styles/tokens.css 的 --font-<id>。
 */
const CONTENT_FONT_IDS = ['pingfang', 'songti', 'kaiti', 'yuanti', 'hiragino'];

const VIEW_BUTTON_TITLE = {
  edit: 'action.preview',
  preview: 'action.split',
  split: 'action.exitPreview',
};

function applyViewMode(mode) {
  const next = VIEW_ORDER.includes(mode) ? mode : 'edit';
  state.viewMode = next;

  el.editorHost.hidden = next === 'preview';
  el.previewHost.hidden = next === 'edit';
  el.content.dataset.view = next;

  paintPreview();

  el.viewButton.dataset.view = next;
  el.viewButton.classList.toggle('is-on', next !== 'edit');
  const titleKey = VIEW_BUTTON_TITLE[next];
  el.viewButton.dataset.i18nTitle = titleKey;
  el.viewButton.title = t(titleKey);

  // 分栏会改变编辑器的可用宽度，交给 CodeMirror 重新测量一次
  if (next !== 'preview') {
    requestAnimationFrame(() => editor.requestMeasure());
    editor.focus();
  }
}

/* ------------------------------------------------------- 文件夹栏折叠 */

const SIDEBAR_KEY = 'miaomiao:sidebar-collapsed';

function setSidebarCollapsed(collapsed, persist = true) {
  state.sidebarCollapsed = collapsed;
  el.app.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';

  const titleKey = collapsed ? 'action.expandSidebar' : 'action.collapseSidebar';
  el.sidebarToggle.dataset.i18nTitle = titleKey;
  el.sidebarToggle.title = t(titleKey);
  el.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));

  // 折叠/展开侧栏会改变可用宽度，把拖出来的列表宽度重新钳制一次
  const inline = el.app.style.getPropertyValue('--list-width');
  if (inline) setListWidth(parseFloat(inline) || LIST_MIN_WIDTH);

  if (!persist) return;
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage may be unavailable, not fatal */
  }
}

function restoreSidebar() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    /* storage may be unavailable, not fatal */
  }
  setSidebarCollapsed(collapsed, false);
}

function cycleView() {
  const index = VIEW_ORDER.indexOf(state.viewMode);
  const next = VIEW_ORDER[(index + 1) % VIEW_ORDER.length];
  applyViewMode(next);
  // 实时落盘：关掉再打开时沿用最后一次的视图
  saveSettings({ defaultView: next });
}

/** ⌘E 的语义保持不变：全屏预览 ↔ 只写。 */
function togglePreview() {
  const next = state.viewMode === 'preview' ? 'edit' : 'preview';
  applyViewMode(next);
  saveSettings({ defaultView: next });
}


/* ------------------------------------------------- 列表宽度拖拽 */

const LIST_MIN_WIDTH = 220;
const LIST_MAX_WIDTH = 520;
const CONTENT_MIN_WIDTH = 360;
const LIST_KEY_STEP = 16;
const LIST_WIDTH_KEY = 'miaomiao:list-width';

function pxVar(name, fallback) {
  const raw = parseFloat(getComputedStyle(el.app).getPropertyValue(name));
  return Number.isFinite(raw) ? raw : fallback;
}

/** 上限还要保证写作区不被挤到看不见 */
function listMaxWidth() {
  const available = el.app.clientWidth - pxVar('--sidebar-width', 208) - CONTENT_MIN_WIDTH;
  return Math.max(LIST_MIN_WIDTH, Math.min(LIST_MAX_WIDTH, available));
}

function setListWidth(width) {
  const clamped = Math.min(Math.max(width, LIST_MIN_WIDTH), listMaxWidth());
  const rounded = Math.round(clamped);
  el.app.style.setProperty('--list-width', `${rounded}px`);
  // 分隔条按像素汇报，min/max 也跟着当下的可用宽度走，读屏才知道边界在哪
  el.listResizer.setAttribute('aria-valuemin', String(LIST_MIN_WIDTH));
  el.listResizer.setAttribute('aria-valuemax', String(Math.round(listMaxWidth())));
  el.listResizer.setAttribute('aria-valuenow', String(rounded));
  return rounded;
}

/**
 * 当前的列表宽度。列宽有 260ms 过渡，刚改完读 rect 会拿到动画中的旧值，
 * 所以优先用内联值——连续按键/拖动才不会越走越偏。
 */
function currentListWidth() {
  const inline = parseFloat(el.app.style.getPropertyValue('--list-width'));
  if (Number.isFinite(inline)) return inline;
  return el.notesPane.getBoundingClientRect().width;
}

/** 记住用户拖出来的宽度；传 null 表示回到默认。 */
function rememberListWidth(width) {
  try {
    if (width == null) localStorage.removeItem(LIST_WIDTH_KEY);
    else localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* storage may be unavailable, not fatal */
  }
}

/** 双击/回到默认：清掉内联值与记住的宽度，让 tokens 与媒体查询重新接管 */
function resetListWidth() {
  el.app.style.removeProperty('--list-width');
  el.listResizer.removeAttribute('aria-valuenow');
  el.listResizer.removeAttribute('aria-valuemin');
  el.listResizer.removeAttribute('aria-valuemax');
  rememberListWidth(null);
}

function restoreListWidth() {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(LIST_WIDTH_KEY));
  } catch {
    return;
  }
  if (!Number.isFinite(stored) || stored <= 0) return;
  // 窗口比上次窄（或侧栏展开）时，setListWidth 会按当下可用空间重新钳制。
  setListWidth(stored);
}

function startListDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();

  const startX = event.clientX;
  const startWidth = el.notesPane.getBoundingClientRect().width;
  let lastWidth = startWidth;
  el.listResizer.classList.add('is-active');
  el.app.classList.add('is-resizing');
  document.body.classList.add('is-resizing');
  el.listResizer.setPointerCapture(event.pointerId);

  const onMove = (moveEvent) => {
    lastWidth = setListWidth(startWidth + (moveEvent.clientX - startX));
  };

  const onEnd = () => {
    el.listResizer.classList.remove('is-active');
    el.app.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing');
    el.listResizer.removeEventListener('pointermove', onMove);
    el.listResizer.removeEventListener('pointerup', onEnd);
    el.listResizer.removeEventListener('pointercancel', onEnd);
    // 只在用户真的拖过之后记住，窗口缩放导致的钳制不算。
    rememberListWidth(lastWidth);
  };

  el.listResizer.addEventListener('pointermove', onMove);
  el.listResizer.addEventListener('pointerup', onEnd);
  el.listResizer.addEventListener('pointercancel', onEnd);
}

function onResizerKey(event) {
  const step = event.shiftKey ? LIST_KEY_STEP * 3 : LIST_KEY_STEP;
  const current = currentListWidth();
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    rememberListWidth(setListWidth(current - step));
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    rememberListWidth(setListWidth(current + step));
  }
}

/* ---------------------------------------------------------------- settings */

/**
 * 打开中的设置面板的刷新函数。设置面板没有草稿，所有改动即时生效，
 * 所以任何一次 applySettings 都要把面板里的勾选态同步过来。
 */
let syncSettingsDialog = null;

/** 当前打开的设置面板的关闭函数。菜单和按钮都可能触发，避免叠出两层。 */
let closeSettingsDialog = null;

/** Apply settings to the live document. Called on boot and after every change. */
function applySettings(next) {
  state.settings = next;
  document.documentElement.dataset.theme = next.theme === 'dark' ? 'dark' : 'cream';
  document.documentElement.style.setProperty('--editor-font-size', `${next.fontSize}px`);
  // 正文字体：写作区和阅读区共用一套，值只存 id，字体栈交给 tokens.css
  const fontId = CONTENT_FONT_IDS.includes(next.fontFamily) ? next.fontFamily : 'pingfang';
  document.documentElement.style.setProperty('--font-content', `var(--font-${fontId})`);
  document.body.classList.toggle('reduce-motion', Boolean(next.reduceMotion));

  // 主题变了，mermaid 图表要按新配色重画（浅色/深色两套主题变量）
  if (el.previewHost && state.activeNote) paintPreview();

  if (next.language) setLanguage(next.language);
  applyI18n();
  updateSyncHint();

  // 让列表与文件夹栏立即反映排序、摘要和语言设置
  if (el.noteList && state.notes.length) {
    renderFolders();
    renderNotes();
  }

  if (el.notesTitle) {
    el.notesTitle.textContent = state.activeFolder
      ? state.activeFolder.split('/').pop()
      : t('list.all');
  }

  if (state.activeNote && state.currentMtime) {
    el.contentDate.textContent = t('note.updated', { time: formatDate(state.currentMtime) });
  }

  syncQuickToggles();
  syncSettingsDialog?.();
}

/**
 * 右上角两个快捷开关。图标表示“当前是什么”，标题说明“点了会变成什么”，
 * 所以每次设置变化都要重算一遍文案。
 */
function syncQuickToggles() {
  const languageTarget = getLanguage() === 'zh' ? 'en' : 'zh';
  const themeIsDark = state.settings?.theme === 'dark';

  el.langToggle.title = t(languageTarget === 'en' ? 'action.langToEn' : 'action.langToZh');
  el.themeToggle.title = t(themeIsDark ? 'action.themeToLight' : 'action.themeToDark');
}

/** 保存一个设置项并让界面立即跟随；不经过设置面板。 */
let settingsWriteToken = 0;

async function saveSettings(patch) {
  if (!api) return;

  // 连点几个开关时，只认最后一次写入的结果，避免旧结果把界面冲回去
  const token = (settingsWriteToken += 1);
  const result = await api.settings.set(patch);
  if (token !== settingsWriteToken) return;

  if (!result.ok) {
    toast(t('toast.settingsFailed'), true);
    return;
  }
  applySettings(result.data);
}

function toggleLanguage() {
  saveSettings({ language: getLanguage() === 'zh' ? 'en' : 'zh' });
}

function toggleTheme() {
  saveSettings({ theme: state.settings?.theme === 'dark' ? 'light' : 'dark' });
}

function openSettings() {
  closeSettingsDialog?.();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings__head">
        <div class="settings__heading">
          <h2 class="settings__title" id="settings-title" data-i18n="settings.title">${t('settings.title')}</h2>
          <!-- 面板里没有保存/取消：每一项都即时落盘，这里把规则写清楚 -->
          <p class="settings__subtitle" data-i18n="settings.instantHint">${t('settings.instantHint')}</p>
        </div>
        <button
          class="icon-button settings__close"
          type="button"
          id="settings-close"
          data-i18n-title="settings.close"
          data-i18n-aria="settings.close"
          title="关闭"
          aria-label="关闭"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4" />
          </svg>
        </button>
      </header>
      <div class="settings__body">
        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.appearance">${t('settings.appearance')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.theme">${t('settings.theme')}</strong>
              <span data-i18n="settings.theme.desc">${t('settings.theme.desc')}</span>
            </div>
            <div class="segmented" data-key="theme">
              <button type="button" data-value="light" data-i18n="settings.theme.light">${t('settings.theme.light')}</button>
              <button type="button" data-value="dark" data-i18n="settings.theme.dark">${t('settings.theme.dark')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.fontSize">${t('settings.fontSize')}</strong>
              <span class="js-size-label"></span>
            </div>
            <div class="segmented" data-key="fontSize">
              <button type="button" data-value="13" data-i18n="settings.fontSize.small">${t('settings.fontSize.small')}</button>
              <button type="button" data-value="15" data-i18n="settings.fontSize.medium">${t('settings.fontSize.medium')}</button>
              <button type="button" data-value="17" data-i18n="settings.fontSize.large">${t('settings.fontSize.large')}</button>
            </div>
          </div>
          <div class="settings__row is-stacked">
            <div class="settings__label">
              <strong data-i18n="settings.fontFamily">${t('settings.fontFamily')}</strong>
              <span data-i18n="settings.fontFamily.desc">${t('settings.fontFamily.desc')}</span>
            </div>
            <!-- 每个字库用自己的字体显示，选之前就能看出差别 -->
            <div class="segmented segmented--fonts" data-key="fontFamily">
              ${CONTENT_FONT_IDS.map(
                (id) =>
                  `<button type="button" data-value="${id}" style="font-family: var(--font-${id})" data-i18n="settings.fontFamily.${id}">${t(`settings.fontFamily.${id}`)}</button>`,
              ).join('')}
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.reduceMotion">${t('settings.reduceMotion')}</strong>
              <span data-i18n="settings.reduceMotion.desc">${t('settings.reduceMotion.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="reduceMotion"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.language">${t('settings.language')}</strong>
              <span data-i18n="settings.language.desc">${t('settings.language.desc')}</span>
            </div>
            <div class="segmented" data-key="language">
              <button type="button" data-value="zh" data-i18n="settings.language.zh">${t('settings.language.zh')}</button>
              <button type="button" data-value="en" data-i18n="settings.language.en">${t('settings.language.en')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.list">${t('settings.list')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.sortBy">${t('settings.sortBy')}</strong>
              <span data-i18n="settings.sortBy.desc">${t('settings.sortBy.desc')}</span>
            </div>
            <div class="segmented" data-key="sortBy">
              <button type="button" data-value="mtime" data-i18n="settings.sort.mtime">${t('settings.sort.mtime')}</button>
              <button type="button" data-value="ctime" data-i18n="settings.sort.ctime">${t('settings.sort.ctime')}</button>
              <button type="button" data-value="title" data-i18n="settings.sort.title">${t('settings.sort.title')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.showSnippet">${t('settings.showSnippet')}</strong>
              <span data-i18n="settings.showSnippet.desc">${t('settings.showSnippet.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="showSnippet"></button>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.editor">${t('settings.editor')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.defaultView">${t('settings.defaultView')}</strong>
              <span data-i18n="settings.defaultView.desc">${t('settings.defaultView.desc')}</span>
            </div>
            <div class="segmented" data-key="defaultView">
              <button type="button" data-value="edit" data-i18n="settings.defaultView.edit">${t('settings.defaultView.edit')}</button>
              <button type="button" data-value="preview" data-i18n="settings.defaultView.preview">${t('settings.defaultView.preview')}</button>
              <button type="button" data-value="split" data-i18n="settings.defaultView.split">${t('settings.defaultView.split')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.behavior">${t('settings.behavior')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.telemetry">${t('settings.telemetry')}</strong>
              <span data-i18n="settings.telemetry.desc">${t('settings.telemetry.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="telemetry"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.quit">${t('settings.quit')}</strong>
              <span data-i18n="settings.quit.desc">${t('settings.quit.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="quitOnAllWindowsClosed"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.launchAtLogin">${t('settings.launchAtLogin')}</strong>
              <span data-i18n="settings.launchAtLogin.desc">${t('settings.launchAtLogin.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="launchAtLogin"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.restore">${t('settings.restore')}</strong>
              <span data-i18n="settings.restore.desc">${t('settings.restore.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="restoreLastNote"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.autoSave">${t('settings.autoSave')}</strong>
              <span class="js-delay-label"></span>
            </div>
            <div class="segmented" data-key="autoSaveDelay">
              <button type="button" data-value="300" data-i18n="settings.autoSave.fast">${t('settings.autoSave.fast')}</button>
              <button type="button" data-value="700" data-i18n="settings.autoSave.normal">${t('settings.autoSave.normal')}</button>
              <button type="button" data-value="1500" data-i18n="settings.autoSave.slow">${t('settings.autoSave.slow')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.storage">${t('settings.storage')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.vault">${t('settings.vault')}</strong>
              <span id="js-vault-path">${state.vaultPath || '—'}</span>
            </div>
            <div class="settings__actions">
              <button class="jw-btn" type="button" id="js-change-vault" data-i18n="settings.vault.change">${t('settings.vault.change')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.about">${t('settings.about')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.version">${t('settings.version')}</strong>
              <span id="js-version-line">v${state.appVersion || '—'}</span>
            </div>
            <div class="settings__actions" id="js-update-actions">
              <button class="jw-btn" type="button" id="js-check-update" data-i18n="settings.checkUpdate">${t('settings.checkUpdate')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong data-i18n="settings.autoUpdate">${t('settings.autoUpdate')}</strong>
              <span data-i18n="settings.autoUpdate.desc">${t('settings.autoUpdate.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="autoCheckUpdates"></button>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title" data-i18n="settings.support">${t('settings.support')}</p>
          <button class="sponsor" type="button" id="js-sponsor">
            <svg class="sponsor__cat" viewBox="0 0 64 64" aria-hidden="true">
              <path class="sponsor__ear" d="M18 26 14 10l14 8Z" />
              <path class="sponsor__ear" d="M46 26 50 10 36 18Z" />
              <circle class="sponsor__face" cx="32" cy="34" r="18" />
              <circle class="sponsor__eye" cx="26" cy="32" r="2.4" />
              <circle class="sponsor__eye" cx="38" cy="32" r="2.4" />
              <path class="sponsor__mouth" d="M29 39c1.6 1.8 4.4 1.8 6 0" />
              <ellipse class="sponsor__blush" cx="21" cy="38" rx="3" ry="1.8" />
              <ellipse class="sponsor__blush" cx="43" cy="38" rx="3" ry="1.8" />
            </svg>
            <span class="sponsor__text">
              <strong data-i18n="settings.sponsor.title">${t('settings.sponsor.title')}</strong>
              <em data-i18n="settings.sponsor.desc">${t('settings.sponsor.desc')}</em>
            </span>
            <span class="sponsor__arrow" aria-hidden="true">→</span>
          </button>
        </section>
      </div>
      <div class="settings__developer">
        <button
          class="developer__name"
          type="button"
          id="js-profile"
          data-i18n-title="settings.developerProfile"
          title="在 GitHub 上查看作者"
        >
          <svg class="developer__avatar" viewBox="0 0 24 24" aria-hidden="true">
            <ellipse cx="7" cy="7.5" rx="2.1" ry="2.6" />
            <ellipse cx="12" cy="6" rx="2.1" ry="2.7" />
            <ellipse cx="17" cy="7.5" rx="2.1" ry="2.6" />
            <path d="M12 11.2c2.9 0 5.2 1.9 5.2 4.2 0 2.2-2.3 3.4-5.2 3.4s-5.2-1.2-5.2-3.4c0-2.3 2.3-4.2 5.2-4.2Z" />
          </svg>
          <span>Martin</span>
        </button>
        <button class="developer__item" type="button" id="js-email">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m3.5 7 8.5 6 8.5-6" />
          </svg>
          <span id="js-email-text"></span>
        </button>
        <button class="developer__item" type="button" id="js-github">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="is-filled">
            <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.8 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
          </svg>
          <span>GitHub</span>
        </button>
      </div>
    </div>`;

  const sizeLabel = backdrop.querySelector('.js-size-label');
  const delayLabel = backdrop.querySelector('.js-delay-label');
  const versionLine = backdrop.querySelector('#js-version-line');
  const updateActions = backdrop.querySelector('#js-update-actions');

  /** 面板里的勾选态一律从 state.settings 推导：没有草稿，就没有“保存/取消” */
  const paint = () => {
    const current = state.settings || {};
    if (sizeLabel) sizeLabel.textContent = `${current.fontSize}px`;
    if (delayLabel) delayLabel.textContent = `${current.autoSaveDelay}ms`;

    for (const group of backdrop.querySelectorAll('.segmented')) {
      const key = group.dataset.key;
      for (const button of group.querySelectorAll('button')) {
        const raw = button.dataset.value;
        const numeric = key === 'fontSize' || key === 'autoSaveDelay';
        const value = numeric ? Number(raw) : raw;
        button.classList.toggle('is-active', current[key] === value);
      }
    }
    for (const toggle of backdrop.querySelectorAll('.switch')) {
      toggle.setAttribute('aria-checked', String(Boolean(current[toggle.dataset.key])));
    }
  };

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (syncSettingsDialog === paint) syncSettingsDialog = null;
    if (closeSettingsDialog === close) closeSettingsDialog = null;
  };

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  // 点遮罩关闭（面板外的空白处），面板内部不误触
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      close();
      return;
    }

    const segment = event.target.closest('.segmented button');
    if (segment) {
      const key = segment.parentElement.dataset.key;
      const raw = segment.dataset.value;
      const numeric = key === 'fontSize' || key === 'autoSaveDelay';
      const value = numeric ? Number(raw) : raw;
      // 视图类设置要真的切过去，不然“即时生效”只落了个值
      if (key === 'defaultView' && VIEW_ORDER.includes(value)) applyViewMode(value);
      saveSettings({ [key]: value });
      return;
    }

    const toggle = event.target.closest('.switch');
    if (toggle) {
      const key = toggle.dataset.key;
      saveSettings({ [key]: !state.settings?.[key] });
    }
  });

  backdrop.querySelector('#settings-close').addEventListener('click', close);

  backdrop.querySelector('#js-sponsor')?.addEventListener('click', () => {
    api.app.openProfile();
  });

  backdrop.querySelector('#js-profile')?.addEventListener('click', () => {
    api.app.openProfile();
  });

  backdrop.querySelector('#js-email')?.addEventListener('click', () => {
    api.app.openEmail();
  });

  // 邮箱不在仓库里：打包时由 CONTACT_EMAIL 写进 site.generated.json，经主进程下发。
  // 没配置就隐藏整个入口，避免出现空白的「邮件」按钮。
  const emailButton = backdrop.querySelector('#js-email');
  void (async () => {
    let contactEmail = '';
    try {
      const site = await api.app.site();
      contactEmail = String(site?.contactEmail ?? '');
    } catch {
      contactEmail = '';
    }
    const emailText = backdrop.querySelector('#js-email-text');
    if (emailText) emailText.textContent = contactEmail;
    if (emailButton && !contactEmail) emailButton.hidden = true;
  })();

  backdrop.querySelector('#js-github')?.addEventListener('click', () => {
    api.app.openProfile();
  });

  const vaultPathLabel = backdrop.querySelector('#js-vault-path');
  backdrop.querySelector('#js-change-vault')?.addEventListener('click', async () => {
    const chosen = await api.vault.choose();
    if (!chosen.ok || !chosen.data) return;

    const confirmed = await askConfirm({
      title: t('settings.vault'),
      message: t('settings.vault.confirm', { path: chosen.data }),
      confirmLabel: t('settings.vault.change'),
    });
    if (!confirmed) return;

    const result = await api.vault.switchTo(chosen.data);
    if (!result.ok) {
      toast(t('settings.vault.failed'), true);
      return;
    }

    state.vaultPath = result.data.path;
    if (vaultPathLabel) vaultPathLabel.textContent = result.data.path;
    toast(t('settings.vault.switched'));
    close();
  });

/** Failure reasons reported by the main process, each with its own sentence. */
const UPDATE_FAIL_KEYS = {
  unconfigured: 'settings.updateUnconfigured',
  offline: 'settings.updateOffline',
  server: 'settings.updateServer',
};

  const checkButton = backdrop.querySelector('#js-check-update');
  checkButton?.addEventListener('click', async () => {
    checkButton.disabled = true;
    checkButton.textContent = t('settings.checking');

    const result = await api.app.checkUpdate();
    checkButton.disabled = false;
    checkButton.textContent = t('settings.checkUpdate');

    if (!result.ok) {
      // "Check failed" alone hid a missing site config, a dead network and a server error
      // behind the same words; the main process now reports which one it was.
      const key = UPDATE_FAIL_KEYS[result.reason] || 'settings.updateFailed';
      versionLine.textContent = t(key, { status: result.status ? String(result.status) : '—' });
      return;
    }

    const { hasUpdate, latest, current } = result.data;
    if (!hasUpdate) {
      versionLine.textContent = `v${current} · ${t('settings.upToDate')}`;
      return;
    }

    versionLine.textContent = `v${current} → v${latest}`;
    const download = document.createElement('button');
    download.className = 'jw-btn is-primary';
    download.textContent = t('settings.download');
    download.addEventListener('click', () => api.app.openSite());
    updateActions.replaceChildren(download);
  });

  syncSettingsDialog = paint;
  closeSettingsDialog = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  paint();
}

/* ---------------------------------------------------------------- events */

document.getElementById('btn-new-folder')?.addEventListener('click', createFolder);

document.getElementById('btn-insert-image')?.addEventListener('click', () => {
  document.getElementById('image-input')?.click();
});

document.getElementById('image-input')?.addEventListener('change', async (event) => {
  const input = event.target;
  if (input.files?.length) await handleImageFiles(input.files);
  input.value = '';
});

document.getElementById('btn-new-note').addEventListener('click', createNote);
document.getElementById('btn-empty-new').addEventListener('click', createNote);
el.viewButton.addEventListener('click', cycleView);

/* 阅读区的链接一律往外开：让窗口自己导航走会把笔记界面直接替换成网页，而且没有地址栏回不去。
   #锚点留在本地交给浏览器滚动；http(s)/mailto 交系统浏览器；其他协议（相对路径、file:、javascript:）
   既不导航也不打开。 */
el.previewHost.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) return;
  const href = anchor.getAttribute('href') ?? '';
  if (href.startsWith('#')) return;
  event.preventDefault();
  if (/^(https?:|mailto:)/i.test(href)) void api.app.openExternal(href);
});
el.sidebarToggle.addEventListener('click', () => setSidebarCollapsed(!state.sidebarCollapsed));
el.listResizer.addEventListener('pointerdown', startListDrag);
el.listResizer.addEventListener('keydown', onResizerKey);
el.listResizer.addEventListener('dblclick', resetListWidth);
document.getElementById('btn-more').addEventListener('click', (event) => {
  if (!state.activeNote) return;
  const rect = event.currentTarget.getBoundingClientRect();
  showNoteMenu(state.activeNote, rect.left, rect.bottom + 6);
});

/* 笔记操作只有一个入口：内容区右上角的「更多操作」按钮。
   行上不再挂右键菜单、也不抢双击 —— 列表点击就只负责打开笔记。 */

document.getElementById('btn-settings').addEventListener('click', openSettings);
api.onOpenSettings(openSettings);
api.onSettingsChanged((next) => applySettings(next));
document.getElementById('btn-open-vault').addEventListener('click', () => api.vault.open());
document.getElementById('btn-conflict-dismiss').addEventListener('click', () => {
  el.conflictBanner.hidden = true;
});

el.search.addEventListener('input', () => {
  state.query = el.search.value.trim();
  renderNotes();
});

/* 内容区标题框只读：它不是第二个改名入口，点一下就跳去列表里改那一行。 */
el.titleInput.addEventListener('click', () => startRename(state.activeNote));

window.addEventListener('keydown', (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (!meta) return;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  } else if (event.key.toLowerCase() === 'e') {
    event.preventDefault();
    togglePreview();
  }
});

window.addEventListener('resize', () => {
  const inline = el.app.style.getPropertyValue('--list-width');
  if (inline) setListWidth(parseFloat(inline) || LIST_MIN_WIDTH);
});

api.onMenuNewNote(createNote);

api.onVaultChanged(async (payload) => {
  state.vaultPath = payload.path;
  state.vault = { ...(state.vault || {}), ...payload };
  updateSyncHint();
  state.activeNote = null;
  state.dirty = false;
  editor.reset('');
  el.contentHeader.hidden = true;
  applyViewMode('edit');
  el.editorHost.hidden = true;
  el.emptyState.hidden = false;
  await refresh();
});

/* ---------------------------------------------------------------- boot */

async function boot() {
  const versionResult = await api.app.version();
  if (versionResult.ok) state.appVersion = versionResult.data.version;

  const settingsResult = await api.settings.get();
  applySettings(
    settingsResult.ok
      ? settingsResult.data
      : { theme: 'light', fontSize: 15, autoSaveDelay: 700, restoreLastNote: true },
  );

  restoreSidebar();
  restoreListWidth();

  const info = await api.vault.info();
  if (info.ok) {
    state.vault = info.data;
    state.vaultPath = info.data.path;
    updateSyncHint();
    el.syncHint.title = info.data.path;
  }

  await refresh();

  if (state.notes.length) {
    let target = state.notes[0].path;
    if (state.settings.restoreLastNote) {
      try {
        const last = localStorage.getItem('miaomiao:last-note');
        if (last && state.notes.some((note) => note.path === last)) target = last;
      } catch {
        /* ignore */
      }
    }
    await openNote(target);
  } else {
    el.emptyState.hidden = false;
    el.contentHeader.hidden = true;
    el.editorHost.hidden = true;
  }
}

boot();
