import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import attrs from 'markdown-it-attrs';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import katex from 'katex';

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import java from 'highlight.js/lib/languages/java';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';

const LANGS = {
  javascript,
  typescript,
  java,
  python,
  go,
  bash,
  shell: bash,
  json,
  yaml,
  xml,
  html: xml,
  css,
  sql,
  markdown,
};

for (const [name, definition] of Object.entries(LANGS)) {
  hljs.registerLanguage(name, definition);
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="language-${lang}">${html}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    // mermaid 不是 hljs 语言：保留 language-* 类名，交给 renderMermaid 二次渲染
    const langClass = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : '';
    return `<pre class="hljs"><code${langClass}>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

md.use(anchor, { permalink: false });
md.use(attrs);
md.use(footnote);
md.use(taskLists, { enabled: true, label: true });
md.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: { throwOnError: false, output: 'html' },
});

/**
 * Render markdown to HTML. Raw HTML is disabled, so output is safe to inject.
 * `baseDir` (absolute) rewrites relative image paths to file:// URLs so pasted
 * screenshots render inside the preview.
 */
export function renderMarkdown(source, baseDir) {
  const html = md.render(String(source || ''));
  if (!baseDir) return html;

  const root = baseDir.replace(/\/+$/, '');
  return html.replace(/<img\s+([^>]*?)src="([^"]+)"/g, (match, attrs, src) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return match;
    // markdown-it already URL-encodes the link target; encoding again would
    // turn %E4%BB%A3 into %25E4%25BB and break the file:// lookup.
    return `<img ${attrs}src="file://${encodeURI(root)}/${src}"`;
  });
}

/* ------------------------------------------------------------------
   Mermaid

   代码块里的 ```mermaid 会被 markdown-it 当成普通代码块（class="language-mermaid"），
   预览注入后由这里二次渲染成 SVG。mermaid 体积不小，所以只有真的出现图表时才
   动态 import，并且用「源码 + 主题」做指纹，避免每次敲键都重排一遍。
   ------------------------------------------------------------------ */

import { t } from './i18n.js';

let mermaidPromise = null;

function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  return mermaidPromise;
}

/** 从 CSS 变量里取当前主题色，让图表跟着浅色/深色主题走。 */
function themeVariables(themeName) {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    darkMode: themeName === 'dark',
    background: v('--surface-app', '#f4f5f7'),
    primaryColor: v('--accent-soft', '#fbe7df'),
    primaryTextColor: v('--text-strong', '#1f2328'),
    primaryBorderColor: v('--accent-line', '#e9a88d'),
    secondaryColor: v('--code-bg', '#f1f3f6'),
    tertiaryColor: v('--surface-raised', '#ffffff'),
    lineColor: v('--border-strong', 'rgba(70,85,105,0.17)'),
    textColor: v('--text-body', '#383d44'),
    clusterBkg: v('--surface-list', '#f9fafb'),
    clusterBorder: v('--border-subtle', 'rgba(70,85,105,0.10)'),
    // 连线标签底下那层底色：不设的话暗色主题会变成黑块
    edgeLabelBackground: v('--surface-raised', '#ffffff'),
    labelBackground: v('--surface-raised', '#ffffff'),
    nodeTextColor: v('--text-strong', '#1f2328'),
    titleColor: v('--text-strong', '#1f2328'),
    noteBkgColor: v('--accent-soft', '#fbe7df'),
    noteTextColor: v('--text-strong', '#1f2328'),
    noteBorderColor: v('--accent-line', '#e9a88d'),
    actorBkg: v('--accent-soft', '#fbe7df'),
    actorTextColor: v('--text-strong', '#1f2328'),
    actorBorder: v('--accent-line', '#e9a88d'),
    signalColor: v('--text-body', '#383d44'),
    signalTextColor: v('--text-body', '#383d44'),
    labelColor: v('--text-body', '#383d44'),
    fontFamily: v('--font-ui', '-apple-system, sans-serif'),
    fontSize: '13px',
  };
}

/**
 * 把预览容器里的 mermaid 代码块渲染成 SVG。
 * 渲染失败时保留原始代码块，并在下面补一行错误提示，不让整篇预览崩掉。
 */
export async function renderMermaid(root, themeName = 'cream') {
  if (!root) return;

  const blocks = Array.from(root.querySelectorAll('code.language-mermaid'));
  if (!blocks.length) {
    delete root.dataset.mermaidKey;
    return;
  }

  const key = `${themeName}::${blocks.map((b) => b.textContent).join('\n\u0000\n')}`;
  if (root.dataset.mermaidKey === key) return;

  let mermaid;
  try {
    mermaid = (await loadMermaid()).default;
  } catch {
    return; // 加载失败就当普通代码块显示，不阻塞预览
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: themeName === 'dark',
    themeVariables: themeVariables(themeName),
    flowchart: { curve: 'basis', htmlLabels: true, padding: 12 },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  });

  for (const code of blocks) {
    const source = code.textContent || '';
    const host = code.closest('pre');
    if (!host || host.dataset.mermaidDone === '1') continue;

    const frame = document.createElement('div');
    frame.className = 'mermaid';
    frame.textContent = source;

    // mermaid 需要节点已经在文档里（它要量尺寸），所以先替换再渲染；
    // 失败时把原始代码块放回去，并在下面补一行原因。
    host.replaceWith(frame);
    try {
      await mermaid.run({ nodes: [frame], suppressErrors: false });
    } catch (error) {
      const notice = document.createElement('p');
      notice.className = 'mermaid-error';
      notice.textContent = t('preview.mermaidError', {
        error: String(error?.message || error).split('\n')[0],
      });
      frame.replaceWith(host);
      host.after(notice);
      host.classList.add('mermaid-broken');
    }
    host.dataset.mermaidDone = '1';
  }

  root.dataset.mermaidKey = key;
}
