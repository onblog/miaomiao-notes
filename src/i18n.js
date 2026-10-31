/**
 * 界面文案字典。只有渲染进程使用；主进程的菜单有自己的一份精简字典。
 * 新增文案时两边都要加，否则菜单会回落成中文。
 */

const messages = {
  zh: {
    'app.name': '喵喵笔记',
    'list.all': '全部笔记',
    'list.search': '搜索笔记',
    'list.empty': '这里还没有笔记',
    'list.noResults': '没有找到相关笔记',
    'list.blank': '（空白笔记）',

    'action.newNote': '新建笔记 (⌘N)',
    'action.newFolder': '新建文件夹',
    'action.insertImage': '插入图片',
    'action.preview': '预览 (⌘E)',
    'action.split': '边写边读',
    'action.collapseSidebar': '折叠文件夹',
    'action.expandSidebar': '展开文件夹',
    'action.exitPreview': '退出预览',
    'action.more': '更多操作',
    'action.settings': '设置',
    'action.reveal': '在 Finder 中显示',
    'action.save': '保存',
    'action.create': '创建',
    'action.cancel': '取消',
    'action.delete': '删除',
    'action.rename': '重命名',
    'action.langToEn': '切换到 English',
    'action.langToZh': '切换到中文',
    'action.themeToDark': '切换到深色主题',
    'action.themeToLight': '切换到浅色主题',

    'empty.title': '喵～还没有笔记',
    'empty.desc': '点右上角「＋」新建一条，或者把 .md 文件拖进 iCloud 文件夹',
    'empty.cta': '新建第一条笔记',

    'conflict.message': '检测到 iCloud 冲突副本，内容不会自动合并。',
    'conflict.dismiss': '知道了',

    'note.updated': '更新于 {time}',

    'time.justNow': '刚刚',
    'time.minutes': '{n} 分钟前',
    'time.hours': '{n} 小时前',
    'time.days': '{n} 天前',

    'toast.loadFailed': '读取笔记失败',
    'toast.openFailed': '打开失败',
    'toast.saveFailed': '保存失败',
    'toast.createFailed': '创建失败',
    'toast.renameFailed': '重命名失败',
    'toast.deleteFailed': '删除失败',
    'toast.settingsSaved': '设置已保存',
    'toast.settingsFailed': '设置保存失败',
    'toast.settingsReset': '已恢复默认设置',
    'toast.imageSaved': '图片已保存',
    'toast.imageFailed': '图片保存失败',
    'toast.needNote': '请先打开一条笔记',
    'toast.copied': '已复制',
    'toast.inserted': '已插入',
    'toast.replaced': '已替换选中内容',

    'dialog.newFolder.title': '新建文件夹',
    'dialog.newFolder.placeholder': '给文件夹起个名字',
    'toast.folderCreated': '文件夹已创建',
    'toast.folderFailed': '创建文件夹失败',
    'dialog.newNote.title': '新建笔记',
    'dialog.newNote.placeholder': '给笔记起个名字',
    'dialog.rename.title': '重命名笔记',
    'dialog.delete.title': '删除笔记',
    'dialog.delete.message': '确定删除「{name}」吗？',
    'dialog.delete.detail': '笔记会被移到 .trash 目录，仍然可以手动找回。',
    'dialog.confirm': '确定',

    'settings.title': '设置',
    'settings.appearance': '外观',
    'settings.theme': '主题',
    'settings.theme.desc': '决定界面的明暗样式',
    'settings.theme.light': '浅色',
    'settings.theme.dark': '深色',
    'settings.fontSize': '编辑器字号',
    'settings.fontSize.desc': '{size}px',
    'settings.fontSize.small': '小',
    'settings.fontSize.medium': '中',
    'settings.fontSize.large': '大',
    'settings.fontFamily': '正文字体',
    'settings.fontFamily.desc': '写作区与阅读区使用的字库，均为 macOS 自带字体',
    'settings.fontFamily.pingfang': '苹方',
    'settings.fontFamily.songti': '宋体',
    'settings.fontFamily.kaiti': '楷体',
    'settings.fontFamily.yuanti': '圆体',
    'settings.fontFamily.hiragino': '冬青黑',
    'time.date': '{m} 月 {d} 日',
    'status.saved': '已保存',
    'status.unsaved': '未保存',
    'status.saving': '保存中…',
    'status.saveFailed': '保存失败',
    'preview.mermaidError': 'Mermaid 渲染失败：{error}',
    'status.ready': '就绪',
    'settings.reduceMotion': '减少动效',
    'settings.reduceMotion.desc': '关闭猫咪漂浮等过渡动画',

    'settings.list': '列表',
    'settings.sortBy': '排序方式',
    'settings.sortBy.desc': '决定笔记列表的排列顺序',
    'settings.sort.mtime': '修改',
    'settings.sort.ctime': '创建',
    'settings.sort.title': '标题',
    'settings.showSnippet': '显示摘要',
    'settings.showSnippet.desc': '在标题下方显示两行正文预览',

    'settings.editor': '编辑器',
    'settings.defaultView': '默认视图',
    'settings.defaultView.desc': '打开笔记时的初始显示方式',
    'settings.defaultView.edit': '只写',
    'settings.defaultView.preview': '预览',
    'settings.defaultView.split': '边写边读',

    'settings.behavior': '行为',
    'settings.telemetry': '匿名使用统计',
    'settings.telemetry.desc': '仅上报随机设备 ID，用于统计使用量，可随时关闭',
    'settings.quit': '关闭所有窗口后退出程序',
    'settings.quit.desc': 'macOS 默认会在后台保留进程',
    'settings.launchAtLogin': '开机自启动',
    'settings.launchAtLogin.desc': '登录 Mac 后自动启动喵喵笔记',
    'settings.restore': '启动时恢复上次笔记',
    'settings.restore.desc': '关闭后改为打开列表第一条',
    'settings.autoSave': '自动保存延迟',
    'settings.autoSave.desc': '{ms}ms',
    'settings.autoSave.fast': '快',
    'settings.autoSave.normal': '标准',
    'settings.autoSave.slow': '慢',

    'settings.language': '语言',
    'settings.language.desc': '界面显示语言',
    'settings.language.zh': '中文',
    'settings.language.en': 'English',

    'settings.support': '支持',
    'settings.developerProfile': '在 GitHub 上查看作者',
    'settings.sponsor.title': '请我喝杯咖啡？',
    'settings.sponsor.desc': '赏一杯咖啡，喵喵就能继续写下去 喵～',
    'settings.storage': '存储',
    'settings.vault': '笔记库位置',
    'settings.vault.change': '更改位置',
    'settings.vault.confirm': '将笔记库切换到\n{path}？\n\n原位置的笔记不会被移动或删除，随时可以切回来。',
    'settings.vault.switched': '笔记库已切换',
    'settings.vault.failed': '切换失败',
    'settings.about': '关于',
    'settings.version': '当前版本',
    'settings.checkUpdate': '检查更新',
    'settings.autoUpdate': '自动检查更新',
    'settings.autoUpdate.desc': '启动时静默检查，有新版本每天最多提醒一次',
    'settings.checking': '检查中…',
    'settings.upToDate': '已是最新版本',
    'settings.updateAvailable': '发现新版本 v{version}',
    'settings.updateFailed': '检查失败，请稍后再试',
    'settings.download': '去官网下载',

    'settings.close': '关闭',
    'settings.instantHint': '改动即时生效',

    'sync.icloud': 'iCloud 同步 · {name}',
    'sync.local': '未检测到 iCloud，使用本地目录',
  },

  en: {
    'app.name': 'Miaomiao Notes',
    'list.all': 'All Notes',
    'list.search': 'Search notes',
    'list.empty': 'No notes here yet',
    'list.noResults': 'No matching notes',
    'list.blank': '(Empty note)',

    'action.newNote': 'New note (⌘N)',
    'action.newFolder': 'New folder',
    'action.insertImage': 'Insert image',
    'action.preview': 'Preview (⌘E)',
    'action.split': 'Split view',
    'action.collapseSidebar': 'Collapse folders',
    'action.expandSidebar': 'Expand folders',
    'action.exitPreview': 'Exit preview',
    'action.more': 'More',
    'action.settings': 'Settings',
    'action.reveal': 'Show in Finder',
    'action.save': 'Save',
    'action.create': 'Create',
    'action.cancel': 'Cancel',
    'action.delete': 'Delete',
    'action.rename': 'Rename',
    'action.langToEn': 'Switch to English',
    'action.langToZh': 'Switch to 中文',
    'action.themeToDark': 'Switch to dark theme',
    'action.themeToLight': 'Switch to light theme',

    'empty.title': 'Meow — no notes yet',
    'empty.desc': 'Click + to create one, or drop .md files into your iCloud folder',
    'empty.cta': 'Create your first note',

    'conflict.message': 'iCloud conflict copies detected. Nothing is merged automatically.',
    'conflict.dismiss': 'Got it',

    'note.updated': 'Updated {time}',

    'time.justNow': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago',
    'time.days': '{n} d ago',

    'toast.loadFailed': 'Could not load notes',
    'toast.openFailed': 'Could not open the note',
    'toast.saveFailed': 'Could not save',
    'toast.createFailed': 'Could not create the note',
    'toast.renameFailed': 'Could not rename',
    'toast.deleteFailed': 'Could not delete',
    'toast.settingsSaved': 'Settings saved',
    'toast.settingsFailed': 'Could not save settings',
    'toast.settingsReset': 'Settings reset to defaults',
    'toast.imageSaved': 'Image saved',
    'toast.imageFailed': 'Could not save the image',
    'toast.needNote': 'Open a note first',
    'toast.copied': 'Copied',
    'toast.inserted': 'Inserted',
    'toast.replaced': 'Replaced the selection',

    'dialog.newFolder.title': 'New folder',
    'dialog.newFolder.placeholder': 'Name the folder',
    'toast.folderCreated': 'Folder created',
    'toast.folderFailed': 'Could not create the folder',
    'dialog.newNote.title': 'New note',
    'dialog.newNote.placeholder': 'Name your note',
    'dialog.rename.title': 'Rename note',
    'dialog.delete.title': 'Delete note',
    'dialog.delete.message': 'Delete “{name}”?',
    'dialog.delete.detail': 'The note moves to .trash and can still be recovered.',
    'dialog.confirm': 'OK',

    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.theme': 'Theme',
    'settings.theme.desc': 'Light or dark interface',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.fontSize': 'Editor font size',
    'settings.fontSize.desc': '{size}px',
    'settings.fontSize.small': 'Small',
    'settings.fontSize.medium': 'Medium',
    'settings.fontSize.large': 'Large',
    'settings.fontFamily': 'Body font',
    'settings.fontFamily.desc': 'Typeface for the editor and preview, all built into macOS',
    'settings.fontFamily.pingfang': 'PingFang',
    'settings.fontFamily.songti': 'Songti',
    'settings.fontFamily.kaiti': 'Kaiti',
    'settings.fontFamily.yuanti': 'Yuanti',
    'settings.fontFamily.hiragino': 'Hiragino',
    'time.date': '{m}/{d}',
    'status.saved': 'Saved',
    'status.unsaved': 'Unsaved',
    'status.saving': 'Saving…',
    'status.saveFailed': 'Save failed',
    'preview.mermaidError': 'Mermaid failed to render: {error}',
    'status.ready': 'Ready',
    'settings.reduceMotion': 'Reduce motion',
    'settings.reduceMotion.desc': 'Disable the cat float and other transitions',

    'settings.list': 'List',
    'settings.sortBy': 'Sort by',
    'settings.sortBy.desc': 'Order of the note list',
    'settings.sort.mtime': 'Modified',
    'settings.sort.ctime': 'Created',
    'settings.sort.title': 'Title',
    'settings.showSnippet': 'Show snippet',
    'settings.showSnippet.desc': 'Two-line preview under each title',

    'settings.editor': 'Editor',
    'settings.defaultView': 'Default view',
    'settings.defaultView.desc': 'How a note opens',
    'settings.defaultView.edit': 'Editor',
    'settings.defaultView.preview': 'Preview',
    'settings.defaultView.split': 'Split',

    'settings.behavior': 'Behaviour',
    'settings.telemetry': 'Anonymous usage',
    'settings.telemetry.desc': 'Sends a random device ID only; turn off anytime',
    'settings.quit': 'Quit when all windows close',
    'settings.quit.desc': 'macOS keeps the app running by default',
    'settings.launchAtLogin': 'Launch at login',
    'settings.launchAtLogin.desc': 'Start Miaomiao Notes automatically after you log in',
    'settings.restore': 'Reopen last note',
    'settings.restore.desc': 'Otherwise open the first note in the list',
    'settings.autoSave': 'Autosave delay',
    'settings.autoSave.desc': '{ms}ms',
    'settings.autoSave.fast': 'Fast',
    'settings.autoSave.normal': 'Normal',
    'settings.autoSave.slow': 'Slow',

    'settings.language': 'Language',
    'settings.language.desc': 'Interface language',
    'settings.language.zh': '中文',
    'settings.language.en': 'English',

    'settings.support': 'Support',
    'settings.developerProfile': 'View the author on GitHub',
    'settings.sponsor.title': 'Buy me a coffee?',
    'settings.sponsor.desc': 'A cup keeps the cat writing 喵～',
    'settings.storage': 'Storage',
    'settings.vault': 'Library location',
    'settings.vault.change': 'Change',
    'settings.vault.confirm': 'Switch the library to\n{path}?\n\nNotes in the current location are not moved or deleted; you can switch back anytime.',
    'settings.vault.switched': 'Library switched',
    'settings.vault.failed': 'Could not switch the library',
    'settings.about': 'About',
    'settings.version': 'Version',
    'settings.checkUpdate': 'Check for updates',
    'settings.autoUpdate': 'Check automatically',
    'settings.autoUpdate.desc': 'Silent check on launch, at most one reminder per day',
    'settings.checking': 'Checking…',
    'settings.upToDate': "You're up to date",
    'settings.updateAvailable': 'v{version} is available',
    'settings.updateFailed': 'Check failed, try again later',
    'settings.download': 'Download',

    'settings.close': 'Close',
    'settings.instantHint': 'Changes apply instantly',

    'sync.icloud': 'iCloud · {name}',
    'sync.local': 'iCloud unavailable — using a local folder',
  },
};

let current = 'zh';

export function setLanguage(lang) {
  current = lang === 'en' ? 'en' : 'zh';
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
}

export function getLanguage() {
  return current;
}

export function isEnglish() {
  return current === 'en';
}

/** Translate a key, with optional {placeholder} interpolation. */
export function t(key, vars) {
  let text = messages[current][key] ?? messages.zh[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Fill every element carrying a data-i18n* attribute. */
export function applyI18n(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    if (node.dataset.i18n) node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    if (node.dataset.i18nTitle) node.title = t(node.dataset.i18nTitle);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    if (node.dataset.i18nPlaceholder) node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of root.querySelectorAll('[data-i18n-aria]')) {
    if (node.dataset.i18nAria) node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
}
