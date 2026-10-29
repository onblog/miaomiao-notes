/**
 * 喵喵笔记官网前端：语言切换 + 版本信息 + 多线程下载。
 * 零依赖、零第三方请求，所有逻辑都在这个文件里。
 *
 * 下载逻辑刻意不再拆到 `/download.js`：两个文件各自被浏览器缓存、各自按自己的
 * 规则重新校验，一次发版就会撞成「新 download.js + 旧 app.js」的组合，import 的
 * 名字对不上，整页 JS 直接不执行。（2026-10-23 真的踩了一次。）单文件之后，
 * 缓存只会整体偏新或整体偏旧，不会再拼出坏的中间态。
 */

/* ---------------------------------------------------------------- download */

const CHUNK_COUNT_LARGE = 8;
const CHUNK_COUNT_SMALL = 4;
const LARGE_FILE = 50 * 1024 * 1024;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把 dmg 切成多段并发请求，实时上报进度，返回按顺序拼好的 Blob。
 * 收益来自「链路利用率」而不是「突破带宽」——单连接被限速时，并发能叠加。
 * 前提：服务端支持 Range（Worker 的 /api/download 返回 206 + Content-Range）。
 */
async function downloadFile(url, size, onProgress, signal) {
  const chunkCount = size >= LARGE_FILE ? CHUNK_COUNT_LARGE : CHUNK_COUNT_SMALL;
  const chunkSize = Math.ceil(size / chunkCount);

  const parts = new Array(chunkCount).fill(null);
  let loaded = 0;

  const downloadRange = async (index) => {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize - 1, size - 1);
    if (start > end) return;

    // 一个分片失败时重试两次，避免整次下载白费
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal,
        });
        if (response.status !== 206) throw new Error(`unexpected status ${response.status}`);

        const reader = response.body.getReader();
        const buffers = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffers.push(value);
          loaded += value.length;
          onProgress?.(loaded, size);
        }
        parts[index] = new Blob(buffers);
        return;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (attempt === 2) throw error;
        await delay(400 * (attempt + 1));
      }
    }
  };

  await Promise.all(Array.from({ length: chunkCount }, (_, index) => downloadRange(index)));

  return new Blob(parts, { type: 'application/octet-stream' });
}

/**
 * 直接存进浏览器默认的下载位置。
 *
 * 刻意不用 `showSaveFilePicker()`、不用 File System Access API：那条路在真正开始
 * 传输之前会先弹一个系统「选择下载位置」面板（.dmg 还会再来一次确认），对一个
 * 下载按钮来说摩擦太大。普通 a[download] 点击则是静默落盘，与喵喵吧台一致。
 */
function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const messages = {
  zh: {
    'meta.title': '喵喵笔记 · 本地优先的 Markdown 笔记应用',
    brand: '喵喵笔记',
    'nav.stats': '数据',
    'hero.title': '喵喵笔记',
    'hero.tagline': '一只喵喵的本地 Markdown 笔记应用',
    'hero.desc': '笔记就是 iCloud Drive 里的普通 .md 文件，多台 Mac 自动同步。完全免费，不需要登录。',
    'download.arm64': '下载 Apple Silicon 版',
    'download.x64': '下载 Intel 版',
    'download.hint': 'macOS 12 及以上 · 首次打开若被系统拦住：系统设置 → 隐私与安全性 →「仍要打开」',
    'download.latest': '最新版本',
    'download.direct': '直接下载',
    'download.preparing': '准备中…',
    'download.progress': '正在下载',
    'download.done': '下载完成',
    'download.saved': '已存入「下载」文件夹',
    'download.failed': '下载失败，请改用直链',
    'download.cancel': '取消',
    'download.retry': '重试',
    'download.unavailable': '安装包还在上传，稍后再来',

    'gk.title': '首次打开需要允许一次',
    'gk.intro':
      '下载完成。应用不是从 App Store 安装的，macOS 第一次会拦下它——这是正常现象，放行一次即可。',
    'gk.step1':
      '把「喵喵笔记.app」拖进「应用程序」，双击打开；看到「未打开」的提示时点「完成」。',
    'gk.step2':
      '打开「系统设置 → 隐私与安全性」，在「安全性」区域找到被阻止的应用，点「仍要打开」。',
    'gk.step3': '输入 Mac 密码或使用触控 ID，之后就能正常双击打开。',
    'gk.note': '如果系统提示「已损坏」，在「终端」里执行一次：',
    'gk.copy': '复制',
    'gk.copied': '已复制',
    'gk.ok': '我知道了',
    'feature.layout.title': '三栏布局',
    'feature.layout.desc': '文件夹、笔记、内容三列，参考 macOS 备忘录的交互，切换笔记不丢光标位置。',
    'feature.files.title': '笔记就是文件',
    'feature.files.desc': '每条笔记都是普通 Markdown 文件，随时可以用别的编辑器打开、grep、丢进 Git。',
    'feature.icloud.title': 'iCloud 同步',
    'feature.icloud.desc': '不接第三方同步服务，直接把笔记库放在 iCloud Drive，多台 Mac 由系统自动同步。',
    'privacy.title': '关于隐私',
    'privacy.p1': '应用很干净：只发送一条匿名启动信号（随机设备 ID），可在设置里随时关闭。',
    'privacy.p2': '这个官网没有第三方统计、没有广告、没有 Cookie。',
    'privacy.p3': '不记录 IP、不采集设备指纹，代码全部开源，可以自己审计。',
    'footer.license': 'AGPL-3.0 · 商业授权',
    'footer.made': '为 macOS 而做',
  },
  en: {
    'meta.title': 'Miaomiao Notes · A local-first Markdown notes app for macOS',
    brand: 'Miaomiao Notes',
    'nav.stats': 'Stats',
    'hero.title': 'Miaomiao Notes',
    'hero.tagline': 'A local-first Markdown notes app for macOS',
    'hero.desc':
      'Your notes are plain .md files inside iCloud Drive, synced across your Macs by the system. Completely free, no sign-up needed.',
    'download.arm64': 'Download for Apple Silicon',
    'download.x64': 'Download for Intel',
    'download.hint':
      'macOS 12 or later · if the first launch is blocked: System Settings → Privacy & Security → Open Anyway',
    'download.latest': 'Latest',
    'download.direct': 'Direct download',
    'download.preparing': 'Preparing…',
    'download.progress': 'Downloading',
    'download.done': 'Download complete',
    'download.saved': 'Saved to your Downloads folder',
    'download.failed': 'Download failed, try the direct link',
    'download.cancel': 'Cancel',
    'download.retry': 'Retry',
    'download.unavailable': 'The build is still uploading, check back soon',

    'gk.title': 'Allow it once on first launch',
    'gk.intro':
      'Download complete. The app is not distributed through the App Store, so macOS blocks it once — that is expected. Allow it and it opens normally from then on.',
    'gk.step1':
      'Drag “喵喵笔记.app” into Applications and double-click it. When macOS says it cannot verify the app, choose “Done”.',
    'gk.step2':
      'Open System Settings → Privacy & Security. In the Security section, find the blocked app and choose “Open Anyway”.',
    'gk.step3': 'Enter your Mac password or use Touch ID. The app opens normally afterwards.',
    'gk.note': 'If macOS reports the app is damaged, run this once in Terminal:',
    'gk.copy': 'Copy',
    'gk.copied': 'Copied',
    'gk.ok': 'Got it',
    'feature.layout.title': 'Three columns',
    'feature.layout.desc':
      'Folders, notes and content — modelled on Apple Notes, and switching notes keeps your place.',
    'feature.files.title': 'Notes are files',
    'feature.files.desc':
      'Every note is a plain Markdown file you can open, grep or commit with any tool you like.',
    'feature.icloud.title': 'iCloud sync',
    'feature.icloud.desc':
      'No third-party sync service. The vault lives in iCloud Drive and macOS keeps your Macs in sync.',
    'privacy.title': 'Privacy',
    'privacy.p1': 'The app stays clean: one anonymous launch signal (random device id), off-switch in Settings.',
    'privacy.p2': 'This site has no third-party analytics, no ads and no cookies.',
    'privacy.p3': 'No IP logging, no fingerprinting, and the source is open for review.',
    'footer.license': 'AGPL-3.0 · Commercial',
    'footer.made': 'Made for macOS',
  },
};

const STORAGE_KEY = 'miaomiao-site:lang';
let currentLang = 'zh';
let lastRelease = null;

function applyLanguage(lang) {
  currentLang = messages[lang] ? lang : 'zh';
  const dict = messages[currentLang];

  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  document.title = dict['meta.title'];

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.dataset.i18n;
    const text = dict[key];
    if (text) node.textContent = text;
  }

  const label = document.getElementById('lang-label');
  if (label) label.textContent = currentLang === 'zh' ? 'EN' : '中文';

  renderRelease();

  try {
    localStorage.setItem(STORAGE_KEY, currentLang);
  } catch {
    /* storage can be blocked; not fatal */
  }
}

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return '';
  const mb = bytes / (1024 * 1024);
  return `${currentLang === 'zh' ? '约 ' : '~'}${mb.toFixed(0)} MB`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

/** Re-render the version line and file sizes for the active language. */
function renderRelease() {
  const line = document.getElementById('version-line');
  if (!lastRelease) {
    if (line) {
      line.textContent = currentLang === 'zh' ? '安装包准备中' : 'Packages coming soon';
    }
    return;
  }

  for (const [arch, file] of Object.entries(lastRelease.files || {})) {
    const size = document.querySelector(`[data-size="${arch}"]`);
    if (size) size.textContent = formatSize(file.size);
    const link = document.querySelector(`[data-arch="${arch}"]`);
    if (link) link.href = file.url;
  }

  if (line) {
    const when = formatDate(lastRelease.released_at);
    const label = messages[currentLang]['download.latest'];
    line.textContent = `${label} v${lastRelease.version}${when ? ` · ${when}` : ''}`;
  }
}

async function loadRelease() {
  const line = document.getElementById('version-line');

  try {
    const response = await fetch('/api/release', { headers: { Accept: 'application/json' } });
    const payload = await response.json();

    if (!payload.ok || !payload.data) {
      lastRelease = null;
      renderRelease();
      return;
    }

    lastRelease = payload.data;
    renderRelease();
  } catch {
    lastRelease = null;
    if (line) line.textContent = '';
  }
}

/* ---------------------------------------------------------------- download */

let downloadController = null;
let retryArch = null;

function dlEl(id) {
  return document.getElementById(id);
}

function closeDownloadPanel() {
  const backdrop = dlEl('dl-backdrop');
  if (backdrop) backdrop.hidden = true;
  downloadController = null;
}

function paintProgress(loaded, total, startedAt) {
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const fill = dlEl('dl-fill');
  if (fill) fill.style.width = `${percent}%`;

  dlEl('dl-percent').textContent = `${percent}%`;
  dlEl('dl-bytes').textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;

  const elapsed = Math.max(0.2, (Date.now() - startedAt) / 1000);
  dlEl('dl-speed').textContent = `${formatBytes(loaded / elapsed)}/s`;
}

/** 底部轻提示：同一时间只留一条，连点也不会叠起来。 */
let toastTimer = null;

function showToast(message, durationMs = 3400) {
  const toast = dlEl('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, durationMs);
}

async function handleDownload(arch) {
  // 一次只允许一个下载，连点不会开出第二条并发流。
  if (downloadController) return;

  // 清单元数据还没到：按钮上虽然已能点，但尺寸和文件名仍未知，给一句提示。
  if (!lastRelease) {
    showToast(messages[currentLang]['download.preparing']);
    return;
  }

  const file = lastRelease.files?.[arch];
  if (!file) {
    showToast(messages[currentLang]['download.unavailable']);
    return;
  }

  // 点一下就开始下：不弹「选择下载位置」，也不交系统二次确认，
  // 直接落到浏览器默认的「下载」文件夹。
  const backdrop = dlEl('dl-backdrop');
  backdrop.hidden = false;
  dlEl('dl-title').textContent = messages[currentLang]['download.progress'];
  dlEl('dl-file').textContent = file.name;
  dlEl('dl-direct').href = file.url;
  dlEl('dl-direct').hidden = true;
  dlEl('dl-cancel').textContent = messages[currentLang]['download.cancel'];
  paintProgress(0, file.size, Date.now());

  retryArch = null;
  const controller = new AbortController();
  downloadController = controller;
  const startedAt = Date.now();
  let lastPaint = 0;

  try {
    const blob = await downloadFile(
      file.url,
      file.size,
      (loaded, total) => {
        const now = Date.now();
        if (now - lastPaint > 120) {
          lastPaint = now;
          paintProgress(loaded, total, startedAt);
        }
      },
      controller.signal,
    );

    paintProgress(file.size, file.size, startedAt);
    saveBlob(blob, file.name);

    dlEl('dl-title').textContent = messages[currentLang]['download.done'];
    setTimeout(closeDownloadPanel, 1400);
    showToast(`${file.name} · ${messages[currentLang]['download.saved']}`);
    // macOS blocks the first launch of a non-notarized build; explain the allow
    // steps once the download panel has closed, so nobody gets stuck.
    setTimeout(showGatekeeper, 1600);
  } catch (error) {
    if (error.name === 'AbortError') {
      closeDownloadPanel();
      return;
    }
    dlEl('dl-title').textContent = messages[currentLang]['download.failed'];
    dlEl('dl-percent').textContent = '—';
    dlEl('dl-bytes').textContent = '';
    dlEl('dl-speed').textContent = '';
    dlEl('dl-direct').hidden = false;
    dlEl('dl-cancel').textContent = messages[currentLang]['download.retry'];
    retryArch = arch;
  } finally {
    downloadController = null;
  }
}

/* ---------- 首次打开说明（未公证应用） ---------- */

function showGatekeeper() {
  const modal = dlEl('gk');
  if (!modal) return;
  modal.hidden = false;
  dlEl('gk-ok')?.focus();
}

function closeGatekeeper() {
  const modal = dlEl('gk');
  if (modal) modal.hidden = true;
}

function initGatekeeper() {
  const modal = dlEl('gk');
  if (!modal) return;

  dlEl('gk-ok')?.addEventListener('click', closeGatekeeper);
  dlEl('gk-close')?.addEventListener('click', closeGatekeeper);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeGatekeeper();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeGatekeeper();
  });

  const copy = dlEl('gk-copy');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dlEl('gk-cmd')?.textContent ?? '');
      const label = copy.textContent;
      copy.textContent = messages[currentLang]['gk.copied'];
      setTimeout(() => {
        copy.textContent = label;
      }, 1600);
    } catch {
      /* clipboard may be blocked; the command stays selectable */
    }
  });
}

function init() {
  let saved = 'zh';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'zh';
  } catch {
    /* ignore */
  }

  applyLanguage(saved);

  initGatekeeper();

  document.getElementById('lang-toggle')?.addEventListener('click', () => {
    applyLanguage(currentLang === 'zh' ? 'en' : 'zh');
  });

  for (const button of document.querySelectorAll('[data-arch]')) {
    button.addEventListener('click', () => handleDownload(button.dataset.arch));
  }

  dlEl('dl-cancel')?.addEventListener('click', () => {
    if (retryArch) {
      const arch = retryArch;
      retryArch = null;
      closeDownloadPanel();
      handleDownload(arch);
      return;
    }
    downloadController?.abort();
    closeDownloadPanel();
  });

  dlEl('dl-backdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'dl-backdrop') {
      downloadController?.abort();
      closeDownloadPanel();
    }
  });

  loadRelease();
}

init();
