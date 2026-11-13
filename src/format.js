/**
 * 写作区的 Markdown 格式化命令（「段落」「格式」两个菜单的执行层）。
 *
 * 与 Typora 对齐的三条规则：
 *   1. 有选区：行级命令作用在选区覆盖的每一行，行内命令包住选中的文字。
 *   2. 没选区：行级命令作用在当前行，行内命令在光标处插入成对标记并把光标放到中间。
 *   3. 同一条命令再点一次就是取消 —— 标题、列表、引用都是切换式，不会叠出 `## ##`。
 *
 * 所有命令只发一次 transaction，⌘Z 一步就能回到原样；光标/选区交给 CodeMirror
 * 自己映射，行级命令不会把正在输入的位置弄丢。
 */

const MAX_HEADING = 6;

/** 选区覆盖的行区间。选区正好停在下一行行首时，那一行不该被算进来。 */
function selectedLines(state) {
  const range = state.selection.main;
  const doc = state.doc;
  const first = doc.lineAt(range.from);
  let last = doc.lineAt(range.to);
  if (last.number > first.number && range.to === last.from) last = doc.line(last.number - 1);

  const lines = [];
  for (let number = first.number; number <= last.number; number += 1) lines.push(doc.line(number));
  return lines;
}

/** 多行选区里的空行不参与加前缀（否则一个回车就多出一个空列表项）。 */
function targetable(lines) {
  const filled = lines.filter((line) => line.text.trim() !== '');
  return filled.length ? filled : lines;
}

/**
 * 拆出一行里的缩进与块级标记，剩下的才是正文。
 * 只认 Markdown 自己的写法：引用 >、标题 #、列表 - * +、有序 1. 1)、任务 - [ ]。
 */
function analyzeLine(text) {
  const indentMatch = text.match(/^[ \t]*/);
  const indent = indentMatch ? indentMatch[0] : '';
  let rest = text.slice(indent.length);
  const info = { indent, quote: false, heading: 0, list: '', bullet: '-', task: false, content: rest };

  for (let guard = 0; guard < 8; guard += 1) {
    if (!info.quote) {
      const quote = rest.match(/^>\s?/);
      if (quote) {
        info.quote = true;
        rest = rest.slice(quote[0].length);
        continue;
      }
    }

    const heading = rest.match(/^(#{1,6})(?:\s+|$)/);
    if (heading) {
      info.heading = heading[1].length;
      rest = rest.slice(heading[0].length);
      continue;
    }

    const task = rest.match(/^([-*+])\s+\[([ xX])\]\s+/);
    if (task) {
      info.list = 'task';
      info.bullet = task[1];
      info.task = task[2].toLowerCase() === 'x';
      rest = rest.slice(task[0].length);
      continue;
    }

    const bullet = rest.match(/^([-*+])\s+/);
    if (bullet) {
      info.list = 'bullet';
      info.bullet = bullet[1];
      rest = rest.slice(bullet[0].length);
      continue;
    }

    const ordered = rest.match(/^(\d+)[.)]\s+/);
    if (ordered) {
      info.list = 'ordered';
      rest = rest.slice(ordered[0].length);
      continue;
    }

    break;
  }

  info.content = rest;
  return info;
}

/** 按给定的块级属性重新拼一行；不传的字段沿用原来的。 */
function renderLine(info, overrides = {}) {
  const quote = overrides.quote ?? info.quote;
  const heading = overrides.heading ?? info.heading;
  const list = overrides.list ?? info.list;
  const index = overrides.index ?? 1;
  const checked = overrides.checked ?? info.task;

  let prefix = '';
  if (quote) prefix += '> ';
  if (heading) prefix += `${'#'.repeat(Math.min(MAX_HEADING, heading))} `;
  if (list === 'bullet') prefix += `${info.bullet} `;
  if (list === 'ordered') prefix += `${index}. `;
  if (list === 'task') prefix += `- [${checked ? 'x' : ' '}] `;

  return `${info.indent}${prefix}${info.content}`;
}

/** 一次性替换若干整行；内容没变的行不进出 changes，避免无谓的撤销栈。 */
function applyLineEdits(view, edits) {
  const changes = [];
  for (const { line, text } of edits) {
    if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
  }
  if (!changes.length) {
    view.focus();
    return false;
  }

  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
  return true;
}

/* ------------------------------------------------------------- 块级命令 */

function setHeading(view, level) {
  const { state } = view;
  const lines = selectedLines(state);
  const scope = targetable(lines);
  // 整段已经是这一级标题时再点一次 = 取消；混着多级时统一改成这一级
  const all = level > 0 && scope.every((line) => analyzeLine(line.text).heading === level);

  const edits = scope.map((line) => {
    const info = analyzeLine(line.text);
    const heading = all ? 0 : level;
    return { line, text: renderLine(info, { heading, list: heading ? '' : info.list }) };
  });
  return applyLineEdits(view, edits);
}

/** 「段落」：去掉标题、引用、列表标记，回到最朴素的一行正文。 */
function setParagraph(view) {
  const { state } = view;
  const lines = selectedLines(state);
  const scope = targetable(lines);
  const plain = scope.every((line) => {
    const info = analyzeLine(line.text);
    return !info.heading && !info.quote && !info.list;
  });
  if (plain) {
    view.focus();
    return false;
  }

  const edits = scope.map((line) => ({
    line,
    text: renderLine(analyzeLine(line.text), { quote: false, heading: 0, list: '' }),
  }));
  return applyLineEdits(view, edits);
}

function shiftHeading(view, delta) {
  const { state } = view;
  const lines = selectedLines(state);
  const scope = targetable(lines);
  const edits = scope.map((line) => {
    const info = analyzeLine(line.text);
    // 正文行只响应「提升」：变成一级标题。已经是标题的才逐级升降。
    const heading = info.heading === 0
      ? (delta > 0 ? 0 : 1)
      : Math.min(MAX_HEADING, Math.max(1, info.heading + delta));
    return {
      line,
      text: renderLine(info, { heading, list: heading ? '' : info.list }),
    };
  });
  return applyLineEdits(view, edits);
}

function toggleQuote(view) {
  const { state } = view;
  const lines = selectedLines(state);
  const scope = targetable(lines);
  const all = scope.every((line) => analyzeLine(line.text).quote);

  const edits = lines.map((line) => {
    const info = analyzeLine(line.text);
    if (!scope.includes(line)) return { line, text: line.text };
    return { line, text: renderLine(info, { quote: !all }) };
  });
  return applyLineEdits(view, edits);
}

function setList(view, kind) {
  const { state } = view;
  const lines = selectedLines(state);
  const scope = targetable(lines);
  const all = scope.every((line) => analyzeLine(line.text).list === kind);

  const edits = [];
  let index = 1;
  for (const line of lines) {
    if (!scope.includes(line)) {
      edits.push({ line, text: line.text });
      continue;
    }
    const info = analyzeLine(line.text);
    if (info.content.trim() === '') {
      edits.push({ line, text: line.text });
      continue;
    }
    edits.push({
      line,
      text: all
        ? renderLine(info, { list: '' })
        : renderLine(info, { list: kind, heading: 0, index }),
    });
    index += 1;
  }
  return applyLineEdits(view, edits);
}

/** 用围栏包住选区或当前行；围栏语言留空，让用户自己补。 */
function wrapFence(view, marker) {
  const { state } = view;
  const range = state.selection.main;
  const doc = state.doc;
  const fromLine = doc.lineAt(range.from);
  let toLine = doc.lineAt(range.to);
  if (toLine.number > fromLine.number && range.to === toLine.from) {
    toLine = doc.line(toLine.number - 1);
  }

  if (!range.empty) {
    const inner = doc.sliceString(fromLine.from, toLine.to);
    if (inner.trim() === '') {
      const insert = `${marker}\n\n${marker}`;
      view.dispatch({
        changes: { from: fromLine.from, to: toLine.to, insert },
        selection: { anchor: fromLine.from + marker.length + 1 },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    }

    const insert = `${marker}\n${inner}\n${marker}`;
    view.dispatch({
      changes: { from: fromLine.from, to: toLine.to, insert },
      selection: {
        anchor: range.from + marker.length + 1,
        head: range.to + marker.length + 1,
      },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  const info = analyzeLine(fromLine.text);
  if (info.content.trim() === '') {
    const insert = `${marker}\n\n${marker}`;
    view.dispatch({
      changes: { from: fromLine.from, to: fromLine.to, insert },
      selection: { anchor: fromLine.from + marker.length + 1 },
      scrollIntoView: true,
    });
  } else {
    const insert = `${marker}\n${info.content}\n${marker}`;
    view.dispatch({
      changes: { from: fromLine.from, to: fromLine.to, insert },
      selection: { anchor: fromLine.from + marker.length + 1 + info.content.length },
      scrollIntoView: true,
    });
  }
  view.focus();
  return true;
}

/**
 * 在光标处插入一个独立块（表格、分割线、目录……）。
 * 前后各补空行，但已经空着就不再重复补，避免每插一次多出三四个空行。
 */
function insertSeparated(view, body, cursorOffset) {
  const { state } = view;
  const range = state.selection.main;
  const doc = state.doc;
  const pos = range.to;

  const before = doc.sliceString(Math.max(0, pos - 2), pos);
  const lead = pos === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const after = doc.sliceString(pos, Math.min(doc.length, pos + 2));
  const trail = pos === doc.length || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';

  const insert = `${lead}${body}${trail}`;
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + lead.length + cursorOffset },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function insertTable(view, headers) {
  const columns = headers && headers.length ? headers : ['列 1', '列 2', '列 3'];
  const body = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    `| ${columns.map(() => '   ').join(' | ')} |`,
  ].join('\n');
  return insertSeparated(view, body, 2);
}

function insertFrontMatter(view, { title = '', date = '' } = {}) {
  const { state } = view;
  if (state.doc.sliceString(0, 3) === '---') {
    // 已经有 front matter：把光标放到开头，不再套一层
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    view.focus();
    return false;
  }

  // 结尾留一个空行：front matter 与正文之间要空一行，YAML 解析器和编辑器都更好读
  const body = ['---', `title: ${title}`, `date: ${date}`, '---', '', ''].join('\n');
  view.dispatch({
    changes: { from: 0, to: 0, insert: body },
    selection: { anchor: body.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function insertFootnote(view) {
  const { state } = view;
  const doc = state.doc;
  const range = state.selection.main;
  const used = [...doc.toString().matchAll(/\[\^(\d+)\]/g)].map((match) => Number(match[1]));
  const index = used.length ? Math.max(...used) + 1 : 1;
  const ref = `[^${index}]`;
  const definition = `[^${index}]: `;

  const text = doc.toString();
  const gap = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const tail = `${gap}${definition}`;

  // 光标就在文档末尾时不能发两条同位置的插入，否则 CodeMirror 会报重叠
  const changes = range.to === doc.length
    ? [{ from: doc.length, to: doc.length, insert: `${ref}${tail}` }]
    : [
        { from: range.to, to: range.to, insert: ref },
        { from: doc.length, to: doc.length, insert: tail },
      ];

  view.dispatch({
    changes,
    // 光标落在脚注定义的冒号后面，紧接着就能写说明
    selection: { anchor: doc.length + ref.length + tail.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/* ------------------------------------------------------------- 行内命令 */

function wrapInline(view, { left, right = left, label = '' }) {
  const { state } = view;
  const range = state.selection.main;
  const doc = state.doc;
  const rightMark = right;

  if (range.empty) {
    const head = range.head;
    const line = doc.lineAt(head);
    const before = doc.sliceString(Math.max(line.from, head - left.length), head);
    const after = doc.sliceString(head, Math.min(line.to, head + rightMark.length));

    // 光标正卡在一对空标记中间：再点一次就把这对标记删掉
    if (before === left && after === rightMark) {
      view.dispatch({
        changes: [
          { from: head - left.length, to: head, insert: '' },
          { from: head, to: head + rightMark.length, insert: '' },
        ],
        selection: { anchor: head - left.length },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    }

    const anchor = head + left.length;
    view.dispatch({
      changes: { from: head, to: head, insert: `${left}${label}${rightMark}` },
      selection: label ? { anchor, head: anchor + label.length } : { anchor },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  const selected = doc.sliceString(range.from, range.to);
  const outsideBefore = doc.sliceString(Math.max(0, range.from - left.length), range.from);
  const outsideAfter = doc.sliceString(range.to, Math.min(doc.length, range.to + rightMark.length));

  // 选的是标记里面的文字，且标记就在选区外侧 → 连标记一起删
  if (outsideBefore === left && outsideAfter === rightMark) {
    view.dispatch({
      changes: [
        { from: range.from - left.length, to: range.from, insert: '' },
        { from: range.to, to: range.to + rightMark.length, insert: '' },
      ],
      selection: { anchor: range.from - left.length, head: range.to - left.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  // 选区把标记也选进去了 → 只删里层标记
  if (selected.startsWith(left) && selected.endsWith(rightMark) && selected.length >= left.length + rightMark.length) {
    const inner = selected.slice(left.length, selected.length - rightMark.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: inner },
      selection: { anchor: range.from, head: range.from + inner.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  view.dispatch({
    changes: [
      { from: range.from, to: range.from, insert: left },
      { from: range.to, to: range.to, insert: rightMark },
    ],
    selection: { anchor: range.from + left.length, head: range.to + left.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function applyLink(view, { url, label = '' }) {
  const { state } = view;
  const range = state.selection.main;
  const text = range.empty ? label || url : state.doc.sliceString(range.from, range.to);
  const insert = `[${text}](${url})`;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + 1, head: range.from + 1 + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** 去掉一段文字里的行内标记；链接保留可读的文字，脚注引用整段删掉。 */
function stripInline(text) {
  let out = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\$(?!\$)([^$\n]+?)\$(?!\$)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[\^[^\]]*\]/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

function clearInline(view) {
  const { state } = view;
  const range = state.selection.main;
  const doc = state.doc;

  if (!range.empty) {
    const text = doc.sliceString(range.from, range.to);
    const cleaned = stripInline(text);
    if (cleaned === text) return false;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: cleaned },
      selection: { anchor: range.from, head: range.from + cleaned.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  const line = doc.lineAt(range.head);
  const info = analyzeLine(line.text);
  const cleaned = stripInline(info.content);
  if (cleaned === info.content) {
    view.focus();
    return false;
  }
  const contentFrom = line.to - info.content.length;
  view.dispatch({
    changes: { from: contentFrom, to: line.to, insert: cleaned },
    selection: { anchor: contentFrom + cleaned.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/* --------------------------------------------------------------- 入口 */

/**
 * 执行一条命令。返回 true 表示文档真的变了。
 * `options`: tableHeaders、link 的 url/label、front matter 的 title/date。
 */
export function applyFormat(view, command, options = {}) {
  if (!view) return false;

  switch (command) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return setHeading(view, Number(command.slice(1)));
    case 'paragraph':
      return setParagraph(view);
    case 'promote':
      return shiftHeading(view, -1);
    case 'demote':
      return shiftHeading(view, 1);
    case 'quote':
      return toggleQuote(view);
    case 'ordered':
      return setList(view, 'ordered');
    case 'bullet':
      return setList(view, 'bullet');
    case 'task':
      return setList(view, 'task');
    case 'codeBlock':
      return wrapFence(view, '```');
    case 'mathBlock':
      return wrapFence(view, '$$');
    case 'table':
      return insertTable(view, options.tableHeaders);
    case 'hr':
      return insertSeparated(view, '---', 3);
    case 'toc':
      return insertSeparated(view, '[TOC]', 5);
    case 'frontMatter':
      return insertFrontMatter(view, options);
    case 'footnote':
      return insertFootnote(view);
    case 'bold':
      return wrapInline(view, { left: '**' });
    case 'italic':
      return wrapInline(view, { left: '*' });
    case 'strike':
      return wrapInline(view, { left: '~~' });
    case 'inlineCode':
      return wrapInline(view, { left: '`' });
    case 'inlineMath':
      return wrapInline(view, { left: '$' });
    case 'link':
      return applyLink(view, options);
    case 'clearFormat':
      return clearInline(view);
    default:
      return false;
  }
}

/** 菜单勾选状态：光标所在行的块级属性（当前块类型）。 */
export function getBlockState(view) {
  if (!view || !view.state) return null;
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.head);
  return analyzeLine(line.text);
}
