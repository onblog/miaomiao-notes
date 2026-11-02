/**
 * highlight.js 共享实例。
 *
 * 预览区（markdown-it）和写作区（CodeMirror 装饰）必须用同一份语言注册表与
 * 同一套 token 分类，否则同一段 SQL 在左边是彩色、右边是单色，写起来会很割裂。
 *
 * tokenizeCode() 把 hljs 产出的 HTML 还原成「源码偏移 + 语义色名」的区间，
 * 供 CodeMirror 做 mark 装饰；颜色本身仍由 editor.css 里的 --code-* token 决定。
 */

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
import markdownLanguage from 'highlight.js/lib/languages/markdown';

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
  markdown: markdownLanguage,
};

for (const [name, definition] of Object.entries(LANGS)) {
  hljs.registerLanguage(name, definition);
}

export { hljs };

/**
 * hljs 的 class → 语义色名。分组与 styles/app.css 里的 .hljs-* 规则一一对应，
 * 这样写作区和预览区的配色是同一份契约（改配色只动 tokens.css 的 --code-*）。
 */
const KIND_BY_CLASS = {
  'hljs-comment': 'comment',
  'hljs-quote': 'comment',
  'hljs-keyword': 'keyword',
  'hljs-selector-tag': 'keyword',
  'hljs-literal': 'keyword',
  'hljs-section': 'keyword',
  'hljs-link': 'keyword',
  'hljs-string': 'string',
  'hljs-title': 'string',
  'hljs-name': 'string',
  'hljs-attribute': 'string',
  'hljs-symbol': 'string',
  'hljs-bullet': 'string',
  'hljs-addition': 'string',
  'hljs-template-tag': 'string',
  'hljs-template-variable': 'string',
  'hljs-type': 'type',
  'hljs-built_in': 'type',
  'hljs-selector-id': 'type',
  'hljs-selector-class': 'type',
  'hljs-number': 'number',
  'hljs-meta': 'number',
  'hljs-deletion': 'number',
  'hljs-function': 'function',
  'hljs-attr': 'function',
  'hljs-variable': 'attr',
  'hljs-property': 'attr',
  'hljs-params': 'attr',
  'hljs-operator': 'attr',
  'hljs-punctuation': 'punct',
  'hljs-tag': 'punct',
};

/** hljs 11 会用 `hljs-title function_` 这类子作用域表达「函数名」，先认子作用域。 */
function kindOfElement(element) {
  if (!element) return null;
  const classes = element.classList;
  if (!classes) return null;
  if (classes.contains('function_') || classes.contains('class_')) return 'function';
  for (const name of classes) {
    const kind = KIND_BY_CLASS[name];
    if (kind) return kind;
  }
  return null;
}

/** 从叶子往上找，包装 span（.hljs-function 之类）本身没有颜色也要能落到语义色。 */
function kindOfNode(node) {
  for (let element = node; element && element.nodeType === 1; element = element.parentNode) {
    const kind = kindOfElement(element);
    if (kind) return kind;
  }
  return null;
}

/**
 * 缓存：按「语言 + 源码」做键。编辑时只有内容真的变了才会重新分词，
 * 长笔记里滚动、点选都不会触发 hljs 重跑。
 */
const tokenCache = new Map();
const TOKEN_CACHE_LIMIT = 240;

/**
 * 把一段代码切成带语义色的区间。
 * @returns {{from:number,to:number,kind:string}[] | null} 语言未知时返回 null
 */
export function tokenizeCode(code, language) {
  const lang = String(language || '').trim().toLowerCase();
  if (!code || !lang || !hljs.getLanguage(lang)) return null;

  const key = `${lang}\u0000${code}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;

  let spans;
  try {
    const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    spans = parseTokenHtml(html, code.length);
  } catch {
    spans = null;
  }

  if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.clear();
  tokenCache.set(key, spans);
  return spans;
}

/**
 * hljs 返回的是转义后的 HTML（<span class="hljs-keyword">…</span>）。
 * 这里把它解析回偏移区间：文本节点长度就是源码字符数（实体引用解析后长度不变），
 * 一旦总长度对不上（语言实现异常）就整块放弃着色，宁可单色也不错位。
 */
function parseTokenHtml(html, expectedLength) {
  const template = document.createElement('template');
  template.innerHTML = html;

  const supported = typeof NodeFilter !== 'undefined';
  const spans = [];
  let offset = 0;

  if (supported) {
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      if (!text) continue;
      const kind = kindOfNode(node.parentNode);
      if (kind) spans.push({ from: offset, to: offset + text.length, kind });
      offset += text.length;
    }
  } else {
    // 没有 TreeWalker（测试环境）时退化成纯文本长度校验，不着色
    offset = template.content.textContent.length;
  }

  if (offset !== expectedLength) return null;
  return spans;
}
