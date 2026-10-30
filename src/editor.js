import { EditorView, keymap, placeholder, drawSelection, Decoration, ViewPlugin } from '@codemirror/view';
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

/**
 * 暖色语法高亮。CodeMirror 默认的蓝色语法色和奶油底色冲突，
 * 所以这里整套替换掉，保持「纸感」的统一。
 */
const warmHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--text-strong)', fontWeight: '700', fontSize: '1.32em' },
  { tag: tags.heading2, color: 'var(--text-strong)', fontWeight: '700', fontSize: '1.18em' },
  { tag: tags.heading3, color: 'var(--text-body)', fontWeight: '650', fontSize: '1.08em' },
  { tag: tags.strong, color: 'var(--text-strong)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--text-muted)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-faint)' },
  { tag: tags.link, color: 'var(--text-link)' },
  // GFM 会把 work@10.32.140.59 识别成 email 链接、http://… 识别成 URL，
  // 以前一律用 text-faint，结果“深色不亮、浅色不黑”。改用链接色。
  { tag: tags.url, color: 'var(--text-link)' },
  { tag: tags.monospace, color: 'var(--code-inline-text)', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--accent)' },
  { tag: tags.processingInstruction, color: 'var(--accent)' },
  { tag: tags.contentSeparator, color: 'var(--border-strong)' },
  { tag: tags.comment, color: 'var(--text-faint)' },
]);

const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' });
const codeTextMark = Decoration.mark({ class: 'cm-code-text' });

/**
 * lezer 的 Markdown 语法把行内代码与围栏代码内容标成 InlineCode / CodeText，
 * 但它们没有高亮标签，颜色规则挂不上去。这里用装饰器补一层 class，
 * 具体颜色仍然由 editor.css 的 token 决定。
 */
const codeDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildCodeDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildCodeDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function buildCodeDecorations(view) {
  const marks = [];
  syntaxTree(view.state).iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter(node) {
      if (node.name === 'InlineCode') {
        // 只给内容上色，两端的反引号保持语法标记的样子
        const cursor = node.node.cursor();
        if (!cursor.firstChild()) return false;
        const start = cursor.to;
        let end = start;
        while (cursor.nextSibling()) end = cursor.from;
        if (end > start) marks.push(inlineCodeMark.range(start, end));
        return false;
      }
      if (node.name === 'CodeText') {
        if (node.to > node.from) marks.push(codeTextMark.range(node.from, node.to));
        return false;
      }
      return undefined;
    },
  });
  return Decoration.set(marks, true);
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
    syntaxHighlighting(warmHighlight),
    codeDecorations,
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
