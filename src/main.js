import 'katex/dist/katex.min.css';
import './styles/app.css';
import { createEditor } from './editor.js';
import { renderMarkdown } from './preview.js';
import { createMockApi } from './mock-api.js';
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

const editor = createEditor({
  parent: el.editorHost,
  onChange: onDocChange,
  onPasteImage: handleImageFiles,
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
        note.title.toLowerCase().includes(lower) || note.snippet.toLowerCase().includes(lower),
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
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `note-item${state.activeNote === note.path ? ' is-active' : ''}`;
    button.dataset.path = note.path;

    const title = document.createElement('div');
    title.className = 'note-item__title';
    if (state.activeNote === note.path && state.dirty) {
      const dot = document.createElement('span');
      dot.className = 'note-item__dot';
      title.appendChild(dot);
    }
    const titleText = document.createElement('span');
    titleText.textContent = note.title || stemOf(note.name);
    title.appendChild(titleText);

    const meta = document.createElement('div');
    meta.className = 'note-item__meta';
    const time = document.createElement('span');
    time.textContent = relativeTime(note.mtime);
    meta.appendChild(time);

    const snippet = document.createElement('div');
    snippet.className = 'note-item__snippet';
    snippet.textContent = note.snippet || t('list.blank');

    button.append(title, meta, snippet);
    button.addEventListener('click', () => openNote(note.path));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      noteMenu(note.path);
    });
    li.appendChild(button);
    el.noteList.appendChild(li);
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

function onDocChange() {
  if (state.viewMode !== 'edit') {
    el.previewHost.innerHTML = renderMarkdown(editor.getValue(), noteBaseDir());
  }
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

async function renameActive() {
  if (!state.activeNote) return;
  const current = stemOf(state.activeNote.split('/').pop());
  const next = await askInput({ title: t('dialog.rename.title'), value: current, confirmLabel: t('action.rename') });
  if (!next || next === current) return;

  const safe = next.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!safe) return;

  const folder = folderOf(state.activeNote);
  const target = folder ? `${folder}/${safe}.md` : `${safe}.md`;
  const result = await api.notes.rename(state.activeNote, target);
  if (!result.ok) {
    toast(result.error || t('toast.renameFailed'), true);
    return;
  }

  state.activeNote = target;
  el.titleInput.value = safe;
  await refresh();
  renderNotes();
}

async function deleteNote(path = state.activeNote) {
  if (!path) return;
  const confirmed = await api.dialog.confirm({
    title: t('dialog.delete.title'),
    message: t('dialog.delete.message', { name: stemOf(path.split('/').pop()) }),
    detail: t('dialog.delete.detail'),
    confirmLabel: t('action.delete'),
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
  await refresh();
}

/** Right-click menu on a note, rendered by the main process. */
async function noteMenu(path) {
  const result = await api.notes.menu(path);
  if (!result.ok || !result.data) return;

  if (result.data === 'rename') {
    await openNote(path);
    await renameActive();
  } else if (result.data === 'delete') {
    await deleteNote(path);
  }
}

/**
 * 视图三态循环：只写 → 全屏预览 → 边写边读 → 只写。
 * 一个按钮承担三态，图标与提示语跟随当前状态（见 styles/app.css 的 .view-toggle）。
 */
const VIEW_ORDER = ['edit', 'preview', 'split'];

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

  if (next !== 'edit') {
    el.previewHost.innerHTML = renderMarkdown(editor.getValue(), noteBaseDir());
  }

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
  applyViewMode(VIEW_ORDER[(index + 1) % VIEW_ORDER.length]);
}

/** ⌘E 的语义保持不变：全屏预览 ↔ 只写。 */
function togglePreview() {
  applyViewMode(state.viewMode === 'preview' ? 'edit' : 'preview');
}


/* ------------------------------------------------- 列表宽度拖拽（不持久化） */

const LIST_MIN_WIDTH = 220;
const LIST_MAX_WIDTH = 520;
const CONTENT_MIN_WIDTH = 360;
const LIST_KEY_STEP = 16;

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
  el.app.style.setProperty('--list-width', `${Math.round(clamped)}px`);
  return clamped;
}

/** 双击/回到默认：清掉内联值，让 tokens 与媒体查询重新接管 */
function resetListWidth() {
  el.app.style.removeProperty('--list-width');
}

function startListDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();

  const startX = event.clientX;
  const startWidth = el.notesPane.getBoundingClientRect().width;
  el.listResizer.classList.add('is-active');
  el.app.classList.add('is-resizing');
  document.body.classList.add('is-resizing');
  el.listResizer.setPointerCapture(event.pointerId);

  const onMove = (moveEvent) => {
    setListWidth(startWidth + (moveEvent.clientX - startX));
  };

  const onEnd = () => {
    el.listResizer.classList.remove('is-active');
    el.app.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing');
    el.listResizer.removeEventListener('pointermove', onMove);
    el.listResizer.removeEventListener('pointerup', onEnd);
    el.listResizer.removeEventListener('pointercancel', onEnd);
  };

  el.listResizer.addEventListener('pointermove', onMove);
  el.listResizer.addEventListener('pointerup', onEnd);
  el.listResizer.addEventListener('pointercancel', onEnd);
}

function onResizerKey(event) {
  const step = event.shiftKey ? LIST_KEY_STEP * 3 : LIST_KEY_STEP;
  const current = el.notesPane.getBoundingClientRect().width;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    setListWidth(current - step);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    setListWidth(current + step);
  }
}

/* ---------------------------------------------------------------- settings */

/** Apply settings to the live document. Called on boot and after every change. */
function applySettings(next) {
  state.settings = next;
  document.documentElement.dataset.theme = next.theme === 'dark' ? 'dark' : 'cream';
  document.documentElement.style.setProperty('--editor-font-size', `${next.fontSize}px`);
  document.body.classList.toggle('reduce-motion', Boolean(next.reduceMotion));

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
async function saveSettings(patch) {
  if (!api) return;

  const result = await api.settings.set(patch);
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
  const original = { ...(state.settings || {}) };
  const draft = { ...original };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="settings" role="dialog" aria-modal="true">
      <header class="settings__head">
        <h2 class="settings__title">${t('settings.title')}</h2>
      </header>
      <div class="settings__body">
        <section class="settings__group">
          <p class="settings__group-title">${t('settings.appearance')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.theme')}</strong>
              <span>${t('settings.theme.desc')}</span>
            </div>
            <div class="segmented" data-key="theme">
              <button type="button" data-value="light">${t('settings.theme.light')}</button>
              <button type="button" data-value="dark">${t('settings.theme.dark')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.fontSize')}</strong>
              <span class="js-size-label"></span>
            </div>
            <div class="segmented" data-key="fontSize">
              <button type="button" data-value="13">${t('settings.fontSize.small')}</button>
              <button type="button" data-value="15">${t('settings.fontSize.medium')}</button>
              <button type="button" data-value="17">${t('settings.fontSize.large')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.reduceMotion')}</strong>
              <span>${t('settings.reduceMotion.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="reduceMotion"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.language')}</strong>
              <span>${t('settings.language.desc')}</span>
            </div>
            <div class="segmented" data-key="language">
              <button type="button" data-value="zh">${t('settings.language.zh')}</button>
              <button type="button" data-value="en">${t('settings.language.en')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title">${t('settings.list')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.sortBy')}</strong>
              <span>${t('settings.sortBy.desc')}</span>
            </div>
            <div class="segmented" data-key="sortBy">
              <button type="button" data-value="mtime">${t('settings.sort.mtime')}</button>
              <button type="button" data-value="ctime">${t('settings.sort.ctime')}</button>
              <button type="button" data-value="title">${t('settings.sort.title')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.showSnippet')}</strong>
              <span>${t('settings.showSnippet.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="showSnippet"></button>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title">${t('settings.editor')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.defaultView')}</strong>
              <span>${t('settings.defaultView.desc')}</span>
            </div>
            <div class="segmented" data-key="defaultView">
              <button type="button" data-value="edit">${t('settings.defaultView.edit')}</button>
              <button type="button" data-value="preview">${t('settings.defaultView.preview')}</button>
              <button type="button" data-value="split">${t('settings.defaultView.split')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title">${t('settings.behavior')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.telemetry')}</strong>
              <span>${t('settings.telemetry.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="telemetry"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.quit')}</strong>
              <span>${t('settings.quit.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="quitOnAllWindowsClosed"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.restore')}</strong>
              <span>${t('settings.restore.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="restoreLastNote"></button>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.autoSave')}</strong>
              <span class="js-delay-label"></span>
            </div>
            <div class="segmented" data-key="autoSaveDelay">
              <button type="button" data-value="300">${t('settings.autoSave.fast')}</button>
              <button type="button" data-value="700">${t('settings.autoSave.normal')}</button>
              <button type="button" data-value="1500">${t('settings.autoSave.slow')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title">${t('settings.storage')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.vault')}</strong>
              <span id="js-vault-path">${state.vaultPath || '—'}</span>
            </div>
            <div class="settings__actions">
              <button class="jw-btn" type="button" id="js-change-vault">${t('settings.vault.change')}</button>
            </div>
          </div>
        </section>

        <section class="settings__group">
          <p class="settings__group-title">${t('settings.support')}</p>
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
              <strong>${t('settings.sponsor.title')}</strong>
              <em>${t('settings.sponsor.desc')}</em>
            </span>
            <span class="sponsor__arrow" aria-hidden="true">→</span>
          </button>
        </section>

        <section class="settings__group">
          <p class="settings__group-title">${t('settings.about')}</p>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.version')}</strong>
              <span id="js-version-line">v${state.appVersion || '—'}</span>
            </div>
            <div class="settings__actions" id="js-update-actions">
              <button class="jw-btn" type="button" id="js-check-update">${t('settings.checkUpdate')}</button>
            </div>
          </div>
          <div class="settings__row">
            <div class="settings__label">
              <strong>${t('settings.autoUpdate')}</strong>
              <span>${t('settings.autoUpdate.desc')}</span>
            </div>
            <button class="switch" type="button" role="switch" data-key="autoCheckUpdates"></button>
          </div>
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
          Martin
        </button>
        <button class="developer__item" type="button" id="js-email">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m3.5 7 8.5 6 8.5-6" />
          </svg>
          <span>hello@wordtk.com</span>
        </button>
        <button class="developer__item" type="button" id="js-github">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="is-filled">
            <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.8 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
          </svg>
          <span>GitHub</span>
        </button>
      </div>
      <footer class="settings__foot">
        <button class="link-button" type="button" id="settings-reset">${t('settings.reset')}</button>
        <div class="settings__actions">
          <button class="modal__cancel" type="button" id="settings-cancel">${t('settings.cancel')}</button>
          <button class="modal__confirm" type="button" id="settings-save">${t('settings.save')}</button>
        </div>
      </footer>
    </div>`;

  const sizeLabel = backdrop.querySelector('.js-size-label');
  const delayLabel = backdrop.querySelector('.js-delay-label');
  const versionLine = backdrop.querySelector('#js-version-line');
  const updateActions = backdrop.querySelector('#js-update-actions');

  const paint = () => {
    sizeLabel.textContent = `${draft.fontSize}px`;
    delayLabel.textContent = `${draft.autoSaveDelay}ms`;

    for (const group of backdrop.querySelectorAll('.segmented')) {
      const key = group.dataset.key;
      for (const button of group.querySelectorAll('button')) {
        const raw = button.dataset.value;
        const numeric = key === 'fontSize' || key === 'autoSaveDelay';
        const value = numeric ? Number(raw) : raw;
        button.classList.toggle('is-active', draft[key] === value);
      }
    }
    for (const toggle of backdrop.querySelectorAll('.switch')) {
      toggle.setAttribute('aria-checked', String(Boolean(draft[toggle.dataset.key])));
    }
  };

  const close = (applied) => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (!applied) applySettings(original);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') close(false);
  };

  backdrop.addEventListener('click', (event) => {
    const segment = event.target.closest('.segmented button');
    if (segment) {
      const key = segment.parentElement.dataset.key;
      const raw = segment.dataset.value;
      const numeric = key === 'fontSize' || key === 'autoSaveDelay';
      draft[key] = numeric ? Number(raw) : raw;
      applySettings({ ...original, ...draft });
      paint();
      return;
    }

    const toggle = event.target.closest('.switch');
    if (toggle) {
      const key = toggle.dataset.key;
      draft[key] = !draft[key];
      paint();
    }
  });

  backdrop.querySelector('#settings-cancel').addEventListener('click', () => close(false));
  backdrop.querySelector('#settings-reset').addEventListener('click', async () => {
    const result = await api.settings.reset();
    if (result.ok) {
      Object.assign(draft, result.data);
      applySettings(result.data);
      paint();
      toast('已恢复默认设置');
    }
  });
  backdrop.querySelector('#settings-save').addEventListener('click', async () => {
    const result = await api.settings.set(draft);
    if (!result.ok) {
      toast(result.error || '保存设置失败', true);
      return;
    }
    applySettings(result.data);
    close(true);
    toast('设置已保存');
  });

  backdrop.querySelector('#js-sponsor')?.addEventListener('click', () => {
    api.app.openProfile();
  });

  backdrop.querySelector('#js-profile')?.addEventListener('click', () => {
    api.app.openProfile();
  });

  backdrop.querySelector('#js-email')?.addEventListener('click', () => {
    api.app.openEmail();
  });

  backdrop.querySelector('#js-github')?.addEventListener('click', () => {
    api.app.openProfile();
  });

  const vaultPathLabel = backdrop.querySelector('#js-vault-path');
  backdrop.querySelector('#js-change-vault')?.addEventListener('click', async () => {
    const chosen = await api.vault.choose();
    if (!chosen.ok || !chosen.data) return;

    const confirmed = await api.dialog.confirm({
      title: t('settings.vault'),
      message: t('settings.vault.confirm', { path: chosen.data }),
      detail: '',
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
    backdrop.remove();
  });

  const checkButton = backdrop.querySelector('#js-check-update');
  checkButton?.addEventListener('click', async () => {
    checkButton.disabled = true;
    checkButton.textContent = t('settings.checking');

    const result = await api.app.checkUpdate();
    checkButton.disabled = false;
    checkButton.textContent = t('settings.checkUpdate');

    if (!result.ok) {
      sizeLabel && (versionLine.textContent = t('settings.updateFailed'));
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
el.sidebarToggle.addEventListener('click', () => setSidebarCollapsed(!state.sidebarCollapsed));
el.listResizer.addEventListener('pointerdown', startListDrag);
el.listResizer.addEventListener('keydown', onResizerKey);
el.listResizer.addEventListener('dblclick', resetListWidth);
document.getElementById('btn-more').addEventListener('click', () => {
  if (state.activeNote) noteMenu(state.activeNote);
});

el.langToggle.addEventListener('click', toggleLanguage);
el.themeToggle.addEventListener('click', toggleTheme);

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

el.titleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    el.titleInput.blur();
  }
});
el.titleInput.addEventListener('blur', renameActive);

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
