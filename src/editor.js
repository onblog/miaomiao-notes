import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
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
  { tag: tags.link, color: 'var(--accent-strong)' },
  { tag: tags.url, color: 'var(--text-faint)' },
  { tag: tags.monospace, color: 'var(--accent-strong)', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--accent)' },
  { tag: tags.processingInstruction, color: 'var(--accent)' },
  { tag: tags.contentSeparator, color: 'var(--border-strong)' },
  { tag: tags.comment, color: 'var(--text-faint)' },
]);

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
