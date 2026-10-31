'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  dialog,
  nativeTheme,
  screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const {
  icloudRoot,
  defaultVaultPath,
  isICloudPath,
  isICloudAvailable,
  ensureVault,
} = require('./icloud.cjs');
const { createFileService } = require('./files.cjs');
const settings = require('./settings.cjs');

// Load the Vite dev server only when explicitly asked, otherwise use dist/.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

/* ------------------------------------------------------------ window state */

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 780;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 560;

/** Wait for a drag/resize to settle: a fullscreen animation also fires 'resize'. */
const GEOMETRY_SETTLE_MS = 250;

/** Normal (non-zoomed, non-fullscreen) geometry; null until we learn it. */
let lastNormalBounds = null;
let geometryTimer = null;

/**
 * Saved geometry is only trusted while a usable part of it still overlaps a
 * display — monitors get unplugged and resolutions change between launches.
 */
function boundsOnScreen(bounds) {
  if (!bounds) return false;

  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return overlapX >= 160 && overlapY >= 120;
  });
}

/**
 * Write geometry + flags. Called both on close and after a drag settles.
 *
 * While the window is zoomed or fullscreen the normal bounds are the ones we
 * must keep: macOS also reports intermediate frames while the zoom animates, so
 * only a settled, non-zoomed window is allowed to update them.
 */
function persistWindowGeometry() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  const maximized = win.isMaximized();
  const fullScreen = win.isFullScreen();
  if (!maximized && !fullScreen) lastNormalBounds = win.getBounds();

  settings.write({
    windowBounds: lastNormalBounds,
    windowMaximized: maximized,
    windowFullScreen: fullScreen,
  });
}

/** Debounced save: drag and resize fire many events, zoom animations too. */
function trackWindowGeometry() {
  clearTimeout(geometryTimer);
  geometryTimer = setTimeout(persistWindowGeometry, GEOMETRY_SETTLE_MS);
}

/**
 * Anonymous launch beacon.
 *
 * The id is a random UUID stored in userData, so it identifies the install
 * rather than the person: no hardware, no account, no IP. Users can turn this
 * off in Settings, in which case nothing is ever sent.
 */
// 官网地址：优先运行时环境变量，其次打包时由 scripts/write-site-config.cjs
// 写进 bundle 的 electron/site.generated.json（仓库里不出现线上域名）。
// 以前只读 process.env.SITE_URL，双击启动时它是空的，导致「检查更新」永远失败。
const GENERATED_SITE = (() => {
  try {
    return require('./site.generated.json');
  } catch {
    return {};
  }
})();

/** 开发模式便利：允许直接在本仓库根目录的 .env 里写 SITE_URL（该文件不入库）。 */
function readSiteUrlFromDotEnv() {
  try {
    const file = path.join(__dirname, '..', '.env');
    const line = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => /^\s*SITE_URL\s*=/.test(l));
    if (!line) return '';
    return line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return '';
  }
}

const SITE_URL = String(process.env.SITE_URL || GENERATED_SITE.siteUrl || readSiteUrlFromDotEnv() || '')
  .replace(/\/+$/, '');
const STATS_URL = `${SITE_URL}/api/ping`;
const STATS_DELAY_MS = 5000;

let mainWindow = null;
let files = null;
let vaultDir = '';

/** Numeric semver compare; 1.10.0 > 1.9.0 (a plain string compare would fail). */
function compareVersions(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

async function checkLatestRelease() {
  const current = app.getVersion();

  let payload;
  try {
    const response = await fetch(`${SITE_URL}/api/release`, {
      headers: { Accept: 'application/json' },
    });
    payload = await response.json();
  } catch {
    const error = new Error('network');
    error.status = 502;
    throw error;
  }

  if (!payload?.ok || !payload.data?.version) {
    const error = new Error('bad payload');
    error.status = 502;
    throw error;
  }

  const latest = String(payload.data.version);
  return {
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    url: SITE_URL,
  };
}

/**
 * Silent check on launch. When a newer version exists it shows a native dialog,
 * at most once per UTC day, so a user who declines is not nagged on every start.
 */
async function checkForUpdatesOnStartup() {
  const current = settings.read();
  if (current.autoCheckUpdates === false) return;

  let result;
  try {
    result = await checkLatestRelease();
  } catch {
    return;
  }
  if (!result.hasUpdate) return;

  const today = new Date().toISOString().slice(0, 10);
  if (current.lastUpdateNotice === today) return;
  settings.write({ lastUpdateNotice: today });

  const isEnglish = current.language === 'en';
  const text = isEnglish
    ? {
        title: 'Update available',
        message: `Miaomiao Notes v${result.latest} is available`,
        detail: `You are on v${result.current}. Open the website to download the new version?`,
        confirm: 'Download',
        later: 'Later',
      }
    : {
        title: '发现新版本',
        message: `喵喵笔记 v${result.latest} 已发布`,
        detail: `当前版本 v${result.current}，是否前往官网下载？`,
        confirm: '前往下载',
        later: '以后再说',
      };

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: text.title,
    message: text.message,
    detail: text.detail,
    buttons: [text.confirm, text.later],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) shell.openExternal(SITE_URL);
}

function deviceId() {
  const file = path.join(app.getPath('userData'), 'device.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed?.id === 'string' && parsed.id.length === 36) return parsed.id;
  } catch {
    /* first launch */
  }

  const id = randomUUID();
  try {
    fs.writeFileSync(file, JSON.stringify({ id }), 'utf8');
  } catch (error) {
    console.error('[stats] could not persist device id:', error);
  }
  return id;
}

async function reportLaunch() {
  if (settings.read().telemetry === false) return;

  try {
    await fetch(STATS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: deviceId() }),
    });
  } catch {
    /* offline is normal; never surface this to the user */
  }
}

/**
 * Vault resolution order: the path the user picked previously, otherwise
 * iCloud when available, otherwise ~/Documents. The result is persisted so a
 * later iCloud sign-in never silently moves the library.
 */
function resolveVaultPath() {
  const saved = settings.read().vaultPath;
  if (typeof saved === 'string' && saved.length > 0) return saved;

  const detected = defaultVaultPath();
  settings.write({ vaultPath: detected });
  return detected;
}

function bootServices() {
  vaultDir = resolveVaultPath();
  const created = ensureVault(vaultDir);
  files = createFileService(vaultDir);
  return { vault: vaultDir, created, icloud: isICloudAvailable() };
}

function createWindow() {
  const current = settings.read();
  nativeTheme.themeSource = current.theme;

  // Reopen exactly where the user left it; fall back to the default size when
  // the saved rectangle no longer lands on a display.
  const saved = current.windowBounds && boundsOnScreen(current.windowBounds)
    ? current.windowBounds
    : null;
  lastNormalBounds = saved;
  clearTimeout(geometryTimer);

  mainWindow = new BrowserWindow({
    width: saved?.width ?? DEFAULT_WIDTH,
    height: saved?.height ?? DEFAULT_HEIGHT,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: '喵喵笔记',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Restore zoom / fullscreen only once, and only after the first paint: the
  // frame has to exist before macOS runs the animation. A fullscreen window
  // additionally has to be key, so we retry on the first focus as well.
  let revealed = false;
  let modeRestored = false;

  const restoreWindowMode = () => {
    if (modeRestored || !mainWindow || mainWindow.isDestroyed()) return;
    modeRestored = true;
    if (current.windowFullScreen) mainWindow.setFullScreen(true);
    else if (current.windowMaximized) mainWindow.maximize();
  };

  const reveal = () => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    mainWindow.show();
    setTimeout(restoreWindowMode, 120);
  };

  mainWindow.once('ready-to-show', reveal);
  // Safety net: a hidden window can defer its first paint, and ready-to-show
  // would then never fire — an invisible app is worse than one shown a frame
  // early, since it paints the vibrancy material either way.
  const revealFallback = setTimeout(reveal, 1200);
  mainWindow.once('focus', () => setTimeout(restoreWindowMode, 60));

  // Geometry: debounced while dragging, immediate for mode changes and close so
  // "close the window, open it again" never loses the last position.
  mainWindow.on('resize', trackWindowGeometry);
  mainWindow.on('move', trackWindowGeometry);
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, persistWindowGeometry);
  }
  mainWindow.on('close', persistWindowGeometry);
  mainWindow.on('closed', () => clearTimeout(revealFallback));

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ------------------------------------------------------------------ ipc */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(`[ipc:${channel}]`, error);
      return { ok: false, error: error.message || 'unknown error', status };
    }
  });
}

function registerIpc() {
  handle('vault:info', () => ({
    path: vaultDir,
    icloudRoot: icloudRoot(),
    available: isICloudAvailable(),
    isICloud: isICloudPath(vaultDir),
  }));

  handle('vault:open', () => shell.openPath(vaultDir));

  handle('vault:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择笔记库位置',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: vaultDir,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  handle('vault:switch', async (nextPath) => {
    const target = path.resolve(String(nextPath || ''));
    if (!target || target === path.parse(target).root) {
      const error = new Error('invalid vault path');
      error.status = 400;
      throw error;
    }

    const created = ensureVault(target);
    if (!created.ok) {
      const error = new Error(created.error || 'cannot create folder');
      error.status = 400;
      throw error;
    }

    vaultDir = target;
    files = createFileService(target);
    settings.write({ vaultPath: target });

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('vault:changed', {
        path: target,
        available: isICloudAvailable(),
        isICloud: isICloudPath(target),
      });
    }
    return { path: target };
  });

  handle('settings:get', () => settings.read());
  handle('settings:set', (patch) => {
    const previous = settings.read().language;
    const next = settings.write(patch || {});
    nativeTheme.themeSource = next.theme;
    if (next.language !== previous) buildMenu();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', next);
    }
    return next;
  });
  handle('app:version', () => ({
    version: app.getVersion(),
    platform: process.platform,
  }));

  handle('app:check-update', () => checkLatestRelease());

  handle('app:open-site', () => {
    shell.openExternal(SITE_URL);
    return true;
  });

  // 应用内的 GitHub 入口一律指向作者主页（打赏 / 赞助信息在那里）
  handle('app:open-profile', () => {
    shell.openExternal('https://github.com/onblog');
    return true;
  });

  handle('app:open-email', () => {
    shell.openExternal('mailto:hello@wordtk.com');
    return true;
  });

  handle('settings:reset', () => {
    const next = settings.reset();
    nativeTheme.themeSource = next.theme;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', next);
    }
    return next;
  });

  handle('notes:tree', () => files.tree());
  handle('notes:list', () => files.list());
  handle('notes:read', (relative) => files.read(relative));
  handle('notes:write', (relative, content) => files.write(relative, content));
  handle('notes:create', (relative, content) => files.create(relative, content));
  handle('notes:mkdir', (relative) => files.mkdir(relative));
  handle('notes:rename', (from, to) => files.rename(from, to));
  handle('notes:remove', (relative) => files.remove(relative));
  handle('notes:search', (query) => files.search(query));

  /**
   * Save a pasted image next to its note, inside a folder named after the note.
   * `工作/周报.md` -> `工作/周报/<timestamp>.png`, and the returned value is the
   * path relative to the note so it can go straight into Markdown.
   */
  handle('notes:save-image', async (notePath, base64, ext) => {
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    const suffix = allowed.has(String(ext)) ? String(ext) : '.png';

    const relative = String(notePath || '');
    if (!relative.toLowerCase().endsWith('.md')) {
      const error = new Error('save the note first');
      error.status = 400;
      throw error;
    }

    const dir = path.posix.dirname(relative);
    const stem = path.posix.basename(relative, path.posix.extname(relative));
    const folder = dir === '.' ? stem : `${dir}/${stem}`;

    const absoluteDir = path.join(vaultDir, folder);
    await fs.promises.mkdir(absoluteDir, { recursive: true });

    const fileName = `${Date.now()}${suffix}`;
    await fs.promises.writeFile(path.join(absoluteDir, fileName), Buffer.from(String(base64), 'base64'));

    return `${stem}/${fileName}`;
  });

  handle('notes:reveal', (relative) => {
    const target = path.join(files.root, relative);
    shell.showItemInFolder(target);
    return true;
  });

  handle('notes:menu', (relative) => {
    const target = path.join(files.root, relative);
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const menu = Menu.buildFromTemplate([
        { label: '重命名', click: () => done('rename') },
        {
          label: '在 Finder 中显示',
          click: () => {
            shell.showItemInFolder(target);
            done(null);
          },
        },
        { type: 'separator' },
        { label: '删除', click: () => done('delete') },
      ]);

      menu.popup({ window: mainWindow, callback: () => done(null) });
    });
  });

  handle('dialog:confirm', async ({ title, message, detail, confirmLabel }) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: [confirmLabel || currentMenuText().ok, currentMenuText().cancel],
      defaultId: 0,
      cancelId: 1,
      title: title || '喵喵笔记',
      message: message || '',
      detail: detail || '',
    });
    return result.response === 0;
  });
}

/* ------------------------------------------------------------------ menu */

const MENU_TEXT = {
  zh: {
    app: '喵喵笔记',
    about: '关于喵喵笔记',
    prefs: '偏好设置…',
    hide: '隐藏喵喵笔记',
    hideOthers: '隐藏其他',
    unhide: '全部显示',
    quit: '退出喵喵笔记',
    file: '文件',
    newNote: '新建笔记',
    reveal: '在 Finder 中显示',
    close: '关闭窗口',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    reload: '重新加载',
    devtools: '开发者工具',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '全屏',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放',
    ok: '确定',
    cancel: '取消',
  },
  en: {
    app: 'Miaomiao Notes',
    about: 'About Miaomiao Notes',
    prefs: 'Settings…',
    hide: 'Hide Miaomiao Notes',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit Miaomiao Notes',
    file: 'File',
    newNote: 'New Note',
    reveal: 'Show in Finder',
    close: 'Close Window',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    devtools: 'Toggle Developer Tools',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    ok: 'OK',
    cancel: 'Cancel',
  },
};

function currentMenuText() {
  return MENU_TEXT[settings.read().language === 'en' ? 'en' : 'zh'];
}

function buildMenu() {
  const m = currentMenuText();

  const template = [
    {
      label: m.app,
      submenu: [
        { role: 'about', label: m.about },
        { type: 'separator' },
        {
          label: m.prefs,
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:open-settings'),
        },
        { type: 'separator' },
        { role: 'hide', label: m.hide },
        { role: 'hideOthers', label: m.hideOthers },
        { role: 'unhide', label: m.unhide },
        { type: 'separator' },
        { role: 'quit', label: m.quit },
      ],
    },
    {
      label: m.file,
      submenu: [
        {
          label: m.newNote,
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-note'),
        },
        {
          label: m.reveal,
          click: () => shell.openPath(vaultDir),
        },
        { type: 'separator' },
        { role: 'close', label: m.close },
      ],
    },
    {
      label: m.edit,
      submenu: [
        { role: 'undo', label: m.undo },
        { role: 'redo', label: m.redo },
        { type: 'separator' },
        { role: 'cut', label: m.cut },
        { role: 'copy', label: m.copy },
        { role: 'paste', label: m.paste },
        { role: 'selectAll', label: m.selectAll },
      ],
    },
    {
      label: m.view,
      submenu: [
        { role: 'reload', label: m.reload },
        { role: 'toggleDevTools', label: m.devtools },
        { type: 'separator' },
        { role: 'resetZoom', label: m.actualSize },
        { role: 'zoomIn', label: m.zoomIn },
        { role: 'zoomOut', label: m.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: m.fullscreen },
      ],
    },
    {
      label: m.window,
      submenu: [
        { role: 'minimize', label: m.minimize },
        { role: 'zoom', label: m.zoom },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('喵喵笔记');

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: '喵喵笔记',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Martin',
    credits: 'Martin\nhello@wordtk.com',
    authors: ['Martin'],
  });

  bootServices();
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Delay so the window paints first; failures stay silent.
  setTimeout(reportLaunch, STATS_DELAY_MS);
  setTimeout(checkForUpdatesOnStartup, 8000);
});

app.on('window-all-closed', () => {
  // macOS 默认保留进程；只有用户在设置里勾选后才退出。
  if (process.platform !== 'darwin' || settings.read().quitOnAllWindowsClosed) {
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception:', error);
});
