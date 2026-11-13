/**
 * 「段落」「格式」两个下拉菜单（自绘，不用原生 <select> / Menu.popup）。
 *
 * 交互约定：
 *   - 点按钮打开，点外面 / Esc / 再点一次按钮关闭；
 *   - 键盘：按钮上 ↓ 打开并聚焦第一项，菜单内 ↑↓ 移动、Enter 执行、Esc 关闭；
 *   - 当前块类型（标题级别、列表、引用）在菜单里打勾，随时能看到光标落在哪种块里。
 *
 * 面板挂在 body 上而不是按钮里：写作区的容器有 overflow 与层叠上下文，
 * 挂父级会被裁掉；固定定位 + 打开时按按钮位置算坐标最稳。
 */

const CHECK_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m2.6 8.4 3.4 3.3 7.4-7.3" /></svg>';
const CARET_ICON =
  '<svg class="format-menu__caret" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.4 4.4 3.6 3.6 3.6-3.6" /></svg>';

/**
 * 菜单定义。hint 只写真正绑定到键盘的快捷键，
 * 与 main.js 的 handleFormatKey 一一对应，避免菜单写着一个按不出来的组合。
 */
const MENU_CONFIG = [
  {
    key: 'paragraph',
    labelKey: 'menu.paragraph',
    sections: [
      [
        { id: 'h1', labelKey: 'menu.h1', hint: '⌘1', active: (block) => block.heading === 1 },
        { id: 'h2', labelKey: 'menu.h2', hint: '⌘2', active: (block) => block.heading === 2 },
        { id: 'h3', labelKey: 'menu.h3', hint: '⌘3', active: (block) => block.heading === 3 },
        { id: 'h4', labelKey: 'menu.h4', hint: '⌘4', active: (block) => block.heading === 4 },
        { id: 'h5', labelKey: 'menu.h5', hint: '⌘5', active: (block) => block.heading === 5 },
        { id: 'h6', labelKey: 'menu.h6', hint: '⌘6', active: (block) => block.heading === 6 },
      ],
      [
        {
          id: 'paragraph',
          labelKey: 'menu.paragraphItem',
          active: (block) => !block.heading && !block.quote && !block.list,
        },
        { id: 'promote', labelKey: 'menu.promote', hint: '⌃⌘↑' },
        { id: 'demote', labelKey: 'menu.demote', hint: '⌃⌘↓' },
      ],
      [
        { id: 'table', labelKey: 'menu.table' },
        { id: 'codeBlock', labelKey: 'menu.codeBlock', hint: '⌃⌘C' },
        { id: 'mathBlock', labelKey: 'menu.mathBlock', hint: '⌃⌘B' },
      ],
      [{ id: 'quote', labelKey: 'menu.quote', hint: '⌃⌘Q', active: (block) => block.quote }],
      [
        {
          id: 'ordered',
          labelKey: 'menu.ordered',
          hint: '⌃⌘O',
          active: (block) => block.list === 'ordered',
        },
        {
          id: 'bullet',
          labelKey: 'menu.bullet',
          hint: '⌃⌘U',
          active: (block) => block.list === 'bullet',
        },
        { id: 'task', labelKey: 'menu.task', hint: '⌃⌘X', active: (block) => block.list === 'task' },
      ],
      [
        { id: 'hr', labelKey: 'menu.hr' },
        { id: 'toc', labelKey: 'menu.toc' },
        { id: 'frontMatter', labelKey: 'menu.frontMatter' },
      ],
    ],
  },
  {
    key: 'format',
    labelKey: 'menu.format',
    sections: [
      [
        { id: 'bold', labelKey: 'menu.bold', hint: '⌘B' },
        { id: 'italic', labelKey: 'menu.italic', hint: '⌘I' },
        { id: 'strike', labelKey: 'menu.strike', hint: '⌘⇧X' },
        { id: 'inlineCode', labelKey: 'menu.inlineCode', hint: '⌃`' },
      ],
      [
        { id: 'inlineMath', labelKey: 'menu.inlineMath', hint: '⌃M' },
        { id: 'link', labelKey: 'menu.link', hint: '⌘K' },
        { id: 'footnote', labelKey: 'menu.footnote' },
      ],
      [{ id: 'clearFormat', labelKey: 'menu.clearFormat', hint: '⌘\\' }],
    ],
  },
];

function menuItemMarkup(item) {
  return (
    `<span class="format-menu__check">${CHECK_ICON}</span>` +
    `<span class="format-menu__label" data-i18n="${item.labelKey}"></span>` +
    `<span class="format-menu__hint"></span>`
  );
}

export function mountFormatMenus({ host, getState, onSelect, onDismiss }) {
  if (!host) return { close() {} };

  const entries = new Map();
  let opened = null;

  const focusEditor = () => onDismiss?.();

  function closeMenu({ restoreFocus = false } = {}) {
    if (!opened) return;
    opened.panel.hidden = true;
    opened.button.setAttribute('aria-expanded', 'false');
    opened = null;
    if (restoreFocus) focusEditor();
  }

  function syncActive(entry) {
    const block = getState?.();
    for (const { el, def } of entry.items) {
      if (!def.active) continue;
      const active = Boolean(block && def.active(block));
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-checked', String(active));
    }
  }

  function focusItem(entry, index) {
    const items = entry.items.map((item) => item.el);
    if (!items.length) return;
    const next = (index + items.length) % items.length;
    items[next].focus();
  }

  function positionPanel(entry) {
    const rect = entry.button.getBoundingClientRect();
    entry.panel.style.top = `${Math.round(rect.bottom + 6)}px`;
    entry.panel.style.left = '0px';

    const width = entry.panel.offsetWidth || 248;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    entry.panel.style.left = `${Math.round(Math.max(8, left))}px`;

    const room = window.innerHeight - rect.bottom - 18;
    entry.panel.style.maxHeight = `${Math.round(Math.max(180, Math.min(room, 620)))}px`;
  }

  function openMenu(key, { focusFirst = false } = {}) {
    const entry = entries.get(key);
    if (!entry) return;
    closeMenu();

    entry.panel.hidden = false;
    entry.button.setAttribute('aria-expanded', 'true');
    positionPanel(entry);
    syncActive(entry);
    opened = entry;
    if (focusFirst) focusItem(entry, 0);
  }

  for (const config of MENU_CONFIG) {
    const wrap = document.createElement('div');
    wrap.className = 'format-menu';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'format-menu__button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.dataset.i18nTitle = config.labelKey;
    button.dataset.i18nAria = config.labelKey;
    button.innerHTML = `<span data-i18n="${config.labelKey}"></span>${CARET_ICON}`;

    const panel = document.createElement('div');
    panel.className = 'format-menu__panel';
    panel.hidden = true;
    panel.id = `format-menu-${config.key}`;
    panel.setAttribute('role', 'menu');
    panel.dataset.i18nAria = config.labelKey;
    button.setAttribute('aria-controls', panel.id);

    const items = [];
    for (const section of config.sections) {
      const group = document.createElement('div');
      group.className = 'format-menu__group';
      group.setAttribute('role', 'group');

      for (const def of section) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'format-menu__item';
        el.setAttribute('role', def.active ? 'menuitemradio' : 'menuitem');
        el.setAttribute('tabindex', '-1');
        el.dataset.command = def.id;
        el.innerHTML = menuItemMarkup(def);
        el.querySelector('.format-menu__hint').textContent = def.hint ?? '';

        el.addEventListener('click', () => {
          closeMenu();
          onSelect(def.id);
        });

        group.appendChild(el);
        items.push({ el, def });
      }
      panel.appendChild(group);
    }

    panel.addEventListener('keydown', (event) => {
      const list = items.map((item) => item.el);
      const index = list.indexOf(document.activeElement);
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusItem(entries.get(config.key), index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusItem(entries.get(config.key), index <= 0 ? list.length - 1 : index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusItem(entries.get(config.key), 0);
          break;
        case 'End':
          event.preventDefault();
          focusItem(entries.get(config.key), list.length - 1);
          break;
        case 'Escape':
          event.preventDefault();
          closeMenu();
          entries.get(config.key)?.button.focus();
          break;
        case 'Tab':
          closeMenu();
          break;
        default:
          break;
      }
    });

    button.addEventListener('click', () => {
      if (opened === entries.get(config.key)) closeMenu({ restoreFocus: true });
      else openMenu(config.key);
    });

    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu(config.key, { focusFirst: true });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(config.key, { focusFirst: true });
        const entry = entries.get(config.key);
        if (entry) focusItem(entry, entry.items.length - 1);
      }
    });

    wrap.append(button);
    host.appendChild(wrap);
    document.body.appendChild(panel);

    entries.set(config.key, { button, panel, items });
  }

  // 点面板和按钮之外的地方关闭；点另一个菜单按钮时先关再开，鼠标不用抬两次
  document.addEventListener('pointerdown', (event) => {
    if (!opened) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (opened.panel.contains(target) || opened.button.contains(target)) return;
    closeMenu({ restoreFocus: true });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault();
      closeMenu();
      focusEditor();
    }
  });

  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('blur', () => closeMenu());

  return { close: () => closeMenu() };
}
