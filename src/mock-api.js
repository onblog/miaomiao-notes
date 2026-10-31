/**
 * In-memory stand-in for the Electron preload bridge.
 * Only used by `npm run dev` when the page is opened in a plain browser,
 * so the UI can be iterated on without rebuilding the desktop shell.
 */

const seed = [
  {
    path: '产品/喵喵笔记设计稿.md',
    title: '喵喵笔记设计稿',
    folder: '产品',
    content: `# 喵喵笔记设计稿

三栏布局参考 macOS 备忘录：**文件夹 → 笔记 → 内容**。

## 视觉方向

- 暖奶油底色，橘猫作为主色
- 圆角 11–16px，阴影极轻
- 中文用苹方，正文 15px / 1.85 行高

## 待办

- [x] 设计变量抽离
- [x] 三栏骨架
- [ ] 空状态猫咪插画
- [ ] 主题切换

> 一套做精，比十套凑数强。
`,
  },
  {
    path: '产品/iCloud 同步方案.md',
    title: 'iCloud 同步方案',
    folder: '产品',
    content: `# iCloud 同步方案

不接入 CloudKit，直接把笔记库放在 iCloud Drive 目录：

\`\`\`
~/Library/Mobile Documents/com~apple~CloudDocs/MiaomiaoNotes/
\`\`\`

## 冲突处理

iCloud 是最终一致同步，冲突副本长这样：\`笔记 2.md\`。

| 策略 | 是否采用 |
| --- | --- |
| 自动合并 | ❌ |
| 覆盖 | ❌ |
| 提示用户手动处理 | ✅ |
`,
  },
  {
    path: '日记/2026-10-19.md',
    title: '2026-10-19',
    folder: '日记',
    content: `# 2026-10-19

今天把笔记应用的三栏骨架搭起来了。

- 左侧文件夹
- 中间列表
- 右侧编辑区

写得比想象中顺手。
`,
  },
  {
    path: '想法/随手记.md',
    title: '随手记',
    folder: '想法',
    content: `# 随手记

猫咪的呼噜声频率在 25–150 Hz，据说能促进骨骼愈合。

下次查一下这个说法有没有论文支撑。
`,
  },
];

function buildList(store) {
  return [...store.values()].map((note) => ({
    path: note.path,
    name: note.path.split('/').pop(),
    folder: note.folder,
    title: note.title,
    snippet: note.content
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .join(' ')
      .slice(0, 110),
    mtime: Date.now() - Math.floor(Math.random() * 86400000),
    size: note.content.length,
  }));
}

const defaults = {
  language: 'zh',
  telemetry: true,
  vaultPath: '',
  autoCheckUpdates: true,
  theme: 'light',
  fontSize: 15,
  autoSaveDelay: 700,
  quitOnAllWindowsClosed: false,
  launchAtLogin: false,
  restoreLastNote: true,
  sortBy: 'mtime',
  showSnippet: true,
  defaultView: 'edit',
  reduceMotion: false,
};

/** 目录树：把 store 里的路径折叠成 file.tree() 的同构结构 */
function buildTree(store) {
  const root = { children: new Map() };
  for (const note of store.values()) {
    const parts = note.path.split('/').slice(0, -1);
    let node = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!node.children.has(part)) node.children.set(part, { path: acc, children: new Map() });
      node = node.children.get(part);
    }
  }
  const toArray = (node) =>
    [...node.children.values()].map((child) => ({
      type: 'dir',
      path: child.path,
      children: toArray(child),
    }));
  return toArray(root);
}

const mockSettings = { ...defaults };

export function createMockApi() {
  const store = new Map(seed.map((note) => [note.path, note]));

  return {
    platform: 'darwin',
    vault: {
      info: async () => ({
        ok: true,
        data: {
          path: '/Users/you/Library/Mobile Documents/com~apple~CloudDocs/MiaomiaoNotes',
          icloudRoot: '/Users/you/Library/Mobile Documents/com~apple~CloudDocs',
          available: true,
          ready: true,
        },
      }),
      open: async () => ({ ok: true }),
      choose: async () => ({ ok: true, data: '' }),
      switchTo: async () => ({ ok: true }),
    },
    notes: {
      list: async () => ({ ok: true, data: buildList(store) }),
      tree: async () => ({ ok: true, data: buildTree(store) }),
      read: async (path) => {
        const note = store.get(path);
        if (!note) return { ok: false, error: 'note not found' };
        return { ok: true, data: { path, content: note.content, mtime: Date.now(), conflicts: [] } };
      },
      write: async (path, content) => {
        const note = store.get(path);
        if (note) note.content = content;
        return { ok: true, data: { path, conflicts: [] } };
      },
      create: async (path, content) => {
        store.set(path, {
          path,
          title: path.split('/').pop().replace(/\.md$/, ''),
          folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
          content,
        });
        return { ok: true, data: { path } };
      },
      mkdir: async () => ({ ok: true }),
      rename: async (from, to) => {
        const note = store.get(from);
        if (note) {
          store.delete(from);
          store.set(to, { ...note, path: to });
        }
        return { ok: true, data: { from, to } };
      },
      remove: async (path) => {
        store.delete(path);
        return { ok: true, data: { path } };
      },
      search: async () => ({ ok: true, data: [] }),
      saveImage: async (notePath, base64, ext) => ({
        ok: true,
        data: `${notePath.replace(/\.md$/, '').split('/').pop()}/${Date.now()}${ext}`,
      }),
      reveal: async () => ({ ok: true }),
      menu: async () => ({ ok: true, data: null }),
    },
    app: {
      version: async () => ({ ok: true, data: { version: '1.1.0', platform: 'darwin' } }),
      checkUpdate: async () => ({
        ok: true,
        data: { current: '1.1.0', latest: '1.1.0', hasUpdate: false, url: 'https://notes.wordtk.com' },
      }),
      openSite: async () => ({ ok: true }),
      openProfile: async () => ({ ok: true }),
      openEmail: async () => ({ ok: true }),
    },
    dialog: { confirm: async () => true },
    settings: {
      get: async () => ({ ok: true, data: { ...mockSettings } }),
      set: async (patch) => {
        Object.assign(mockSettings, patch);
        return { ok: true, data: { ...mockSettings } };
      },
      reset: async () => {
        Object.assign(mockSettings, defaults);
        return { ok: true, data: { ...mockSettings } };
      },
    },
    onMenuNewNote: () => () => {},
    onVaultChanged: () => () => {},
    onOpenSettings: () => () => {},
    onSettingsChanged: () => () => {},
  };
}
