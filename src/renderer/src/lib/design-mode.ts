export type PickedElement = {
  selector: string
  html: string
  text: string
  styles: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
  url: string
}

const STYLE_KEYS = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'border',
  'border-radius',
  'box-shadow',
  'gap',
  'flex-direction',
  'justify-content',
  'align-items'
]

/**
 * Runs inside the page: highlights the hovered element and resolves with its
 * HTML, a CSS selector, key computed styles and its viewport rect on click.
 * Escape resolves null. The page's own handlers never see the picking click.
 */
export const PICKER_SCRIPT = `new Promise((resolve) => {
  const STYLE_KEYS = ${JSON.stringify(STYLE_KEYS)};
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:3px;transition:all .04s;';
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1d4ed8;color:#fff;font:11px/1.6 ui-monospace,monospace;padding:0 6px;border-radius:3px;';
  document.documentElement.append(overlay, tag);
  let current = null;
  const selectorFor = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let part = el.tagName.toLowerCase();
      const cls = [...el.classList].filter((c) => !c.includes(':')).slice(0, 2);
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const parent = el.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      if (el.id) break;
      el = parent;
    }
    return parts.join(' > ');
  };
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tag) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    tag.textContent = el.tagName.toLowerCase() + ' ' + Math.round(r.width) + '×' + Math.round(r.height);
    Object.assign(tag.style, { left: r.left + 'px', top: Math.max(0, r.top - 18) + 'px' });
  };
  const cleanup = () => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('mousedown', block, true);
    window.removeEventListener('mouseup', block, true);
    window.removeEventListener('keydown', key, true);
    overlay.remove();
    tag.remove();
  };
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };
  const click = (e) => {
    block(e);
    const el = current;
    cleanup();
    if (!el) { resolve(null); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const k of STYLE_KEYS) { const v = cs.getPropertyValue(k); if (v && v !== 'none' && v !== 'normal' && v !== 'auto') styles[k] = v; }
    resolve({
      selector: selectorFor(el),
      html: el.outerHTML.slice(0, 4000),
      text: (el.innerText || '').slice(0, 300),
      styles,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      url: location.href
    });
  };
  const key = (e) => { if (e.key === 'Escape') { block(e); cleanup(); resolve(null); } };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('mousedown', block, true);
  window.addEventListener('mouseup', block, true);
  window.addEventListener('keydown', key, true);
})`

export function formatPickedElement(picked: PickedElement, note: string, screenshotPath: string | null): string {
  const styles = Object.entries(picked.styles)
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ')
  return [
    note.trim() || 'Update this element:',
    '',
    `Page: ${picked.url}`,
    `Element: ${picked.selector}`,
    `HTML: ${picked.html.replace(/\s+/g, ' ').slice(0, 1500)}`,
    `Computed CSS: ${styles}`,
    screenshotPath ? `Screenshot: ${screenshotPath}` : ''
  ]
    .filter((line, index) => line || index === 1)
    .join('\n')
}
