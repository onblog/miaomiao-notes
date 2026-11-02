import {
  EditorView,
  keymap,
  placeholder,
  drawSelection,
  Decoration,
  ViewPlugin,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxTree,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { tokenizeCode } from './code-highlight.js';

/**
 * 写作区着色分两层：
 *
 * 1) HighlightStyle（这一份）负责「字重 / 字号 / 灰度层次」，正文永远是中性色 ——
 *    列表项整行染色会干扰视线，这个坑以前踩过。
 * 2) 只有三类语法元素允许上颜色，全部由下面的装饰器（或 token 变量）单独给出：
 *    围栏代码块里的代码（复用预览那套 --code-* 语义色）、行内代码的文字色、
 *    列表标记（无序 - 与有序 1. 用两种颜色区分）。
 * 3) 颜色一律来自 tokens.css，深色/浅色主题各一套，切换主题不需要重算装饰。
 */
const plainHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--text-strong)', fontWeight: '700', fontSize: '1.32em' },
  { tag: tags.heading2, color: 'var(--text-strong)', fontWeight: '700', fontSize: '1.18em' },
  { tag: tags.heading3, color: 'var(--text-body)', fontWeight: '650', fontSize: '1.08em' },
  { tag: tags.strong, color: 'var(--text-strong)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-faint)' },
  // GFM 会把 work@10.32.140.59 识别成 email 链接、http://… 识别成 URL。
  // 一律用正文色 + 下划线区分，不再染成链接蓝。
  { tag: tags.link, color: 'var(--text-body)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--text-body)' },
  // InlineCode / CodeText（未着色时）与围栏代码外的等宽文本
  { tag: tags.monospace, color: 'var(--text-body)', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  // 列表项正文跟随正文字色；标记符号（-、1.、>、#）由装饰器或 processingInstruction 决定
  { tag: tags.list, color: 'var(--text-body)' },
  { tag: tags.processingInstruction, color: 'var(--text-muted)' },
  // CodeInfo（```sql 里的 sql）与链接标签
  { tag: tags.labelName, color: 'var(--text-faint)' },
  { tag: tags.contentSeparator, color: 'var(--border-strong)' },
  { tag: tags.comment, color: 'var(--text-faint)' },
]);

const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' });
const codeTextMark = Decoration.mark({ class: 'cm-code-text' });
const listBulletMark = Decoration.mark({ class: 'cm-list-bullet' });
const listOrderedMark = Decoration.mark({ class: 'cm-list-ordered' });

/** token 装饰按语义色名缓存，避免每帧都新建 Decoration 对象。 */
const tokenMarkCache = new Map();
function tokenMark(kind) {
  let mark = tokenMarkCache.get(kind);
  if (!mark) {
    mark = Decoration.mark({ class: `cm-tok-${kind}` });
    tokenMarkCache.set(kind, mark);
  }
  return mark;
}

/** 围栏代码块的行装饰（底色 + 首尾圆角）同样缓存，四种组合够用。 */
const codeLineCache = new Map();
function codeLineDecoration(isFirst, isLast) {
  const key = `${isFirst ? 1 : 0}${isLast ? 1 : 0}`;
  let deco = codeLineCache.get(key);
  if (!deco) {
    const classes = ['cm-code-line'];
    if (isFirst) classes.push('cm-code-line-first');
    if (isLast) classes.push('cm-code-line-last');
    deco = Decoration.line({ class: classes.join(' ') });
    codeLineCache.set(key, deco);
  }
  return deco;
}

/**
 * lezer 的 Markdown 语法把行内代码、围栏代码内容标成 InlineCode / CodeText，
 * 但列表标记（ListMark）无法区分有序/无序、代码块内容也没有逐 token 的高亮标签，
 * 这些都要靠遍历语法树补一层 class；颜色仍然由 editor.css 的 token 决定。
 */
const syntaxDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildSyntaxDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildSyntaxDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function buildSyntaxDecorations(view) {
  const { state, viewport } = view;
  const doc = state.doc;
  const ranges = [];

  // 跨行的 mark 装饰在 CodeMirror 里不合法，统一按物理行切开
  const pushMark = (mark, from, to) => {
    let pos = from;
    while (pos < to) {
      const line = doc.lineAt(pos);
      const end = Math.min(to, line.to);
      if (end > pos) ranges.push(mark.range(pos, end));
      if (end >= to) break;
      pos = Math.max(end + 1, pos + 1);
    }
  };

  syntaxTree(state).iterate({
    from: viewport.from,
    to: viewport.to,
    enter(node) {
      switch (node.name) {
        case 'FencedCode':
          decorateFencedCode(node.node, state, viewport, ranges, pushMark);
          return false;
        case 'InlineCode': {
          // 只给内容上色，两端的反引号保持语法标记的样子
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            const start = cursor.to;
            let end = start;
            while (cursor.nextSibling()) end = cursor.from;
            if (end > start) pushMark(inlineCodeMark, start, end);
          }
          return false;
        }
        case 'ListMark':
          pushMark(listMarkerFor(node.node), node.from, node.to);
          return false;
        case 'CodeText':
          // 缩进式代码块（没有围栏）没有语言信息，只统一等宽 + 正文色
          if (node.to > node.from) pushMark(codeTextMark, node.from, node.to);
          return false;
        default:
          return undefined;
      }
    },
  });

  return Decoration.set(ranges, true);
}

/** ListMark 本身不带序数信息，往上找最近的列表类型来决定标记颜色。 */
function listMarkerFor(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'OrderedList') return listOrderedMark;
    if (parent.name === 'BulletList') return listBulletMark;
  }
  return listBulletMark;
}

/**
 * 围栏代码块：整块铺一层代码底色（首尾两行带圆角），内容按 hljs 分词逐 token 上色。
 * 语言未知（```mermaid、```txt 等）时只有底色，保持可读。
 */
function decorateFencedCode(node, state, viewport, ranges, pushMark) {
  const doc = state.doc;
  let open = null;
  let close = null;
  let info = null;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeMark') {
      if (open) close = child;
      else open = child;
    } else if (child.name === 'CodeInfo') {
      info = child;
    }
  }

  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(close ? Math.max(close.from, startLine.from) : node.to);
  for (let number = startLine.number; number <= endLine.number; number += 1) {
    const line = doc.line(number);
    if (line.from > viewport.to || line.to < viewport.from) continue;
    ranges.push(codeLineDecoration(number === startLine.number, number === endLine.number).range(line.from));
  }

  // 语言标记行之后就是代码正文；闭合围栏存在时正文到闭合围栏那一行为止
  const contentFrom = Math.min(doc.length, startLine.to + 1);
  const contentTo = close ? doc.lineAt(close.from).from : node.to;
  if (contentTo <= contentFrom) return;

  const language = info ? doc.sliceString(info.from, info.to) : '';
  const code = doc.sliceString(contentFrom, contentTo);
  const tokens = tokenizeCode(code, language);
  if (!tokens) return;

  for (const token of tokens) {
    const from = Math.max(contentFrom + token.from, viewport.from);
    const to = Math.min(contentFrom + token.to, viewport.to);
    if (to > from) pushMark(tokenMark(token.kind), from, to);
  }
}

function extensionsFor(onChange, onPasteImage) {
  return [
    history(),
    drawSelection(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(plainHighlight),
    syntaxDecorations,
    placeholder('写点什么吧，喵～'),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange?.(update.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      drop(event) {
        const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (!files.length) return false;

        event.preventDefault();
        onPasteImage?.(files);
        return true;
      },
      paste(event) {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of items) {
          if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
          const file = item.getAsFile();
          if (!file) continue;

          event.preventDefault();
          onPasteImage?.([file]);
          return true;
        }
        return false;
      },
    }),
  ];
}

export function createEditor({ parent, onChange, onPasteImage }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: '', extensions: extensionsFor(onChange, onPasteImage) }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    /** Reset the document without emitting a change event when loading a note. */
    reset(value) {
      view.setState(
        EditorState.create({ doc: value, extensions: extensionsFor(onChange, onPasteImage) }),
      );
    },
    focus: () => view.focus(),
    /** Re-measure after the container width changes (split view toggling). */
    requestMeasure: () => view.requestMeasure(),
    insertAtCursor(text) {
      const range = view.state.selection.main;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
  };
}
