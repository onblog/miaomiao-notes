/**
 * 编辑区阅读位置的持久化。
 *
 * 存的是「文档锚点」而不是滚动像素：视口顶部那一行在文档里的字符位置，加上
 * 这一行内部的像素偏移，再补一个光标位置。理由是像素值靠不住 —— 换字号、
 * 改窗口宽度、在正文前面插入几段，同一个 scrollTop 指的就是另一行了；而字符
 * 位置只在「这一行本身被改动」时才失效，那时用同一行也仍然是最接近的位置。
 *
 * 每篇笔记一份，键带 path：换到另一篇时不会把上一篇的位置套上去。
 */

const PREFIX = 'miaomiao:scroll:';
const VERSION = 1;
/** 只留最近读过的这些篇，避免 localStorage 无限长。 */
const LIMIT = 60;

function store() {
  try {
    const storage = window.localStorage;
    // 隐私模式 / 空间满时 localStorage 可能直接抛错，调用方不该因此崩掉。
    return storage ?? null;
  } catch {
    return null;
  }
}

function isSnapshot(value) {
  return Boolean(value) && Number.isInteger(value.pos) && value.pos >= 0;
}

/** 淘汰最旧的那几条，只在真正超出上限时才排序。 */
function prune(storage, now) {
  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(PREFIX)) entries.push({ key, savedAt: readSavedAt(storage, key) });
  }
  if (entries.length <= LIMIT) return;

  entries.sort((a, b) => a.savedAt - b.savedAt);
  for (const entry of entries.slice(0, entries.length - LIMIT)) {
    try {
      storage.removeItem(entry.key);
    } catch {
      /* ignore: pruning is best effort */
    }
  }
  void now;
}

function readSavedAt(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '');
    return typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0;
  } catch {
    return 0;
  }
}

/**
 * Remember where the reader was in `path`.
 * @param {{pos:number, offset:number, selection?:number}} snapshot
 */
export function saveScroll(path, snapshot, now = Date.now()) {
  const storage = store();
  if (!storage || !path || !isSnapshot(snapshot)) return;

  const payload = {
    v: VERSION,
    pos: snapshot.pos,
    offset: Math.max(0, Math.round(Number(snapshot.offset) || 0)),
    selection: Number.isInteger(snapshot.selection) ? snapshot.selection : null,
    savedAt: now,
  };

  try {
    storage.setItem(`${PREFIX}${path}`, JSON.stringify(payload));
    prune(storage, now);
  } catch {
    /* quota or disabled storage: losing the anchor is not worth an error */
  }
}

/** @returns {{pos:number, offset:number, selection:number|null} | null} */
export function loadScroll(path) {
  const storage = store();
  if (!storage || !path) return null;

  try {
    const parsed = JSON.parse(storage.getItem(`${PREFIX}${path}`) ?? '');
    if (!parsed || parsed.v !== VERSION || !isSnapshot(parsed)) return null;
    return {
      pos: parsed.pos,
      offset: Math.max(0, Number(parsed.offset) || 0),
      selection: Number.isInteger(parsed.selection) ? parsed.selection : null,
    };
  } catch {
    return null;
  }
}

/** Only used by tests / the scroll harness. */
export function forgetScroll(path) {
  const storage = store();
  if (!storage || !path) return;
  try {
    storage.removeItem(`${PREFIX}${path}`);
  } catch {
    /* ignore */
  }
}
