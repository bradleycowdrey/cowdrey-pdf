// Runs inside the app on the iOS Simulator (only in the capture build: see boot.js and run.mjs here). It plays one
// App Store story (tests/app-store-stories.mjs, served with this file) in the real app, then tells run.mjs on the Mac,
// which takes the screenshot with `simctl io screenshot`, so the status bar is the Simulator's own.
//
// The stories were written for Playwright's page; `page()` below is a small stand-in for the parts they use. Taps,
// clicks and drags become pointer, touch and mouse events at those points; a drag across a page's text also selects
// it, as a finger does; typing goes through the editing commands, so the app sees the same input events.
/* global STORIES, finish, SERVER */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(SERVER + p, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }).catch(() => {});
const log = (...a) => post('/log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

// Playwright-style selectors: CSS, with an optional :has-text("…") at the end (case-insensitive, contains).
function queryAll(sel, root = document) {
  const m = sel.match(/^(.*):has-text\("(.*)"\)$/);
  const els = [...root.querySelectorAll(m ? m[1] : sel)];
  return m ? els.filter((e) => e.textContent.toLowerCase().includes(m[2].toLowerCase())) : els;
}
const visible = (e) => { if (!e || !e.isConnected || !e.getClientRects().length) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
// WebKit scrolls an editing command's caret into view by its own reckoning, which can be pages away inside the
// app's zoomed viewer; a keyboard leaves the view where it is, so keep every scroll position as it was.
function keepScroll(run) {
  const kept = [];
  for (let e = document.activeElement; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth) kept.push([e, e.scrollTop, e.scrollLeft]);
  const v = document.querySelector('#viewer'); if (v) kept.push([v, v.scrollTop, v.scrollLeft]);
  const wx = scrollX, wy = scrollY;
  try { return run(); } finally { for (const [e, t, l] of kept) { e.scrollTop = t; e.scrollLeft = l; } if (scrollX !== wx || scrollY !== wy) scrollTo(wx, wy); }
}
const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };

function page(kind) {
  let down = null;      // the pointer while a button is down: { target, x, y, anchor, capture }
  let mx = 0, my = 0;   // where the mouse is
  let captureTo = null; // the element that took pointer capture (setPointerCapture, patched in boot.js)
  window.__storeCapture = (el) => { captureTo = el; };
  const opts = (x, y, extra = {}) => ({ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, ...extra });
  const pointer = (type, el, x, y, pointerType, buttons) => el.dispatchEvent(new PointerEvent(type, opts(x, y, { pointerId: pointerType === 'touch' ? 2 : 1, pointerType, isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons, width: 1, height: 1, pressure: buttons ? 0.5 : 0 })));
  const mouse = (type, el, x, y, buttons, detail = 1) => el.dispatchEvent(new MouseEvent(type, opts(x, y, { button: 0, buttons, detail })));
  const touch = (type, el, x, y) => {
    if (typeof Touch !== 'function' || typeof TouchEvent !== 'function') return true;
    try {
      const t = new Touch({ identifier: 2, target: el, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x + scrollX, pageY: y + scrollY, radiusX: 1, radiusY: 1, force: 0.5 });
      const on = type === 'touchend' ? [] : [t];
      return el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, touches: on, targetTouches: on, changedTouches: [t] }));
    } catch { return true; }
  };
  const at = (x, y) => document.elementFromPoint(x, y) || document.body;
  const focusAt = (el, x, y) => {
    // What a press does to focus and the caret: focus the field (or the editable text) under it, caret at the point.
    // (Text fields only: a tap does not focus a button on iOS, and a script's focus would draw the keyboard ring.)
    const f = el.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable=""], [contenteditable="true"]');
    if (f && f !== document.activeElement) f.focus({ preventScroll: true });
    const ed = el.closest('[contenteditable=""], [contenteditable="true"]');
    if (ed) { const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y); if (r && ed.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
  };
  const inText = (el) => el.closest && el.closest('.textLayer');
  const caret = (x, y) => document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
  const clickOn = async (el, x, y, pointerType = 'mouse') => {
    pointer('pointerdown', el, x, y, pointerType, 1);
    if (pointerType === 'touch') touch('touchstart', el, x, y);
    mouse('mousedown', el, x, y, 1); focusAt(el, x, y);
    await sleep(30);
    const up = captureTo || el; captureTo = null;
    pointer('pointerup', up, x, y, pointerType, 0);
    if (pointerType === 'touch') touch('touchend', up, x, y);
    mouse('mouseup', up, x, y, 0); mouse('click', up, x, y, 0);
  };
  const p = {
    kind, errors: [],
    async openDoc(bytes, name) {
      await window.__cowdreyPdf.openBytes(new Uint8Array(bytes), name);
      await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 30000 });
      await sleep(700);
    },
    async evaluate(fn, arg) { return fn(arg); },
    async waitForTimeout(ms) { await sleep(ms); },
    async waitForFunction(fn, arg, o = {}) {
      const end = Date.now() + (o.timeout || 30000);
      for (;;) { let v; try { v = await fn(arg); } catch { v = null; } if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for ' + String(fn).slice(0, 120)); await sleep(100); }
    },
    async waitForSelector(sel, o = {}) {
      return p.waitForFunction(() => queryAll(sel).find(visible), null, { timeout: o.timeout || 30000 }).catch((e) => { throw new Error(`waiting for ${sel}: ${e.message}`); });
    },
    async $(sel) { const e = queryAll(sel)[0]; return e ? { boundingBox: async () => box(e), el: e } : null; },
    locator(sel, o = {}) {
      const list = () => queryAll(sel).filter((e) => !o.hasText || e.textContent.toLowerCase().includes(o.hasText.toLowerCase()));
      const one = () => { const e = list()[0]; if (!e) throw new Error('no element for ' + sel + (o.hasText ? ` "${o.hasText}"` : '')); return e; };
      const loc = {
        first: () => loc,
        count: async () => list().length,
        boundingBox: async () => box(one()),
        click: async () => p._clickEl(one()),
      };
      return loc;
    },
    async _clickEl(e) {
      await p.waitForFunction(() => visible(e), null, { timeout: 30000 });
      const r0 = e.getBoundingClientRect();
      if (r0.bottom < 0 || r0.top > innerHeight || r0.right < 0 || r0.left > innerWidth) e.scrollIntoView({ block: 'center', inline: 'center' });
      const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = at(x, y), el = e.contains(hit) ? hit : e;
      pointer('pointerdown', el, x, y, 'mouse', 1); mouse('mousedown', el, x, y, 1); focusAt(el, x, y);
      pointer('pointerup', el, x, y, 'mouse', 0); mouse('mouseup', el, x, y, 0);
      el.click();
      await sleep(50);
    },
    async click(sel) { await p.waitForSelector(sel); await p._clickEl(queryAll(sel).find(visible)); },
    async fill(sel, value) {
      await p.waitForSelector(sel);
      const e = queryAll(sel).find(visible);
      e.focus();
      if ('select' in e) e.select();
      if (!keepScroll(() => document.execCommand('insertText', false, value)) || e.value !== value) {
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, value);
        e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      }
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    touchscreen: { async tap(x, y) { await clickOn(at(x, y), x, y, 'touch'); } },
    mouse: {
      async move(x, y, o = {}) {
        const steps = o.steps || 1, x0 = mx, y0 = my;
        for (let i = 1; i <= steps; i++) {
          const cx = x0 + (x - x0) * i / steps, cy = y0 + (y - y0) * i / steps;
          const el = captureTo || at(cx, cy);
          pointer('pointermove', el, cx, cy, 'mouse', down ? 1 : 0); mouse('mousemove', el, cx, cy, down ? 1 : 0, 0);
          // a drag that began on a page's text selects it, from where it began to here
          if (down && down.anchor) { const r = caret(cx, cy); if (r) getSelection().setBaseAndExtent(down.anchor.startContainer, down.anchor.startOffset, r.startContainer, r.startOffset); }
          if (steps > 1) await sleep(8);
        }
        mx = x; my = y;
      },
      async down() {
        const el = at(mx, my);
        down = { el, anchor: inText(el) ? caret(mx, my) : null };
        captureTo = null;
        pointer('pointerdown', el, mx, my, 'mouse', 1); mouse('mousedown', el, mx, my, 1);
        if (down.anchor) { const s = getSelection(); s.removeAllRanges(); s.addRange(down.anchor); } else focusAt(el, mx, my);
      },
      async up() {
        const el = captureTo || at(mx, my); captureTo = null;
        pointer('pointerup', el, mx, my, 'mouse', 0); mouse('mouseup', el, mx, my, 0);
        if (down && (down.el === el || down.el.contains(el) || el.contains(down.el))) mouse('click', el, mx, my, 0);
        down = null;
      },
      async click(x, y) { mx = x; my = y; await clickOn(at(x, y), x, y, 'mouse'); },
    },
    keyboard: {
      async press(key) {
        const t = document.activeElement || document.body;
        const ok = t.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, composed: true }));
        if (ok) {
          const s = getSelection();
          if (key === 'End') {
            if ('selectionStart' in t && t.value != null) { try { t.setSelectionRange(t.value.length, t.value.length); } catch {} }
            else if (s.rangeCount) { s.modify('move', 'forward', 'lineboundary'); }
          } else if (key === 'Backspace') keepScroll(() => document.execCommand('delete'));
        }
        t.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true, composed: true }));
        await sleep(10);
      },
      async type(text, o = {}) {
        for (const ch of text) {
          const t = document.activeElement || document.body;
          const ok = t.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true, composed: true }));
          if (ok) t.dispatchEvent(new KeyboardEvent('keypress', { key: ch, charCode: ch.charCodeAt(0), bubbles: true, cancelable: true, composed: true }));
          if (ok) keepScroll(() => document.execCommand('insertText', false, ch));
          t.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true, composed: true }));
          await sleep(o.delay || 10);
        }
      },
    },
  };
  return p;
}

async function bytes(name) { const r = await fetch(SERVER + '/docs/' + name); if (!r.ok) throw new Error('could not fetch ' + name); return new Uint8Array(await r.arrayBuffer()); }

(async () => {
  try {
    const job = await (await fetch(SERVER + '/job')).json();
    if (!job || !job.story) return;
    log('job', job, location.href, innerWidth + 'x' + innerHeight, 'dpr ' + devicePixelRatio, '__TAURI__ ' + !!(window.__TAURI__ && window.__TAURI__.core));
    const story = STORIES.find((s) => s.slug === job.story);
    if (!story) throw new Error('no story ' + job.story);
    const p = page(job.kind);
    addEventListener('error', (e) => { p.errors.push(e.message); log('page error', e.message); });
    addEventListener('unhandledrejection', (e) => { p.errors.push(String(e.reason && e.reason.message || e.reason)); log('page rejection', String(e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
    await p.waitForFunction(() => window.__cowdreyPdf, null, { timeout: 60000 });
    await sleep(1500); // the app's first layout and fonts
    window.__cowdreyPdf.setAuthor && window.__cowdreyPdf.setAuthor('Alex Morgan');
    const meta = await (await fetch(SERVER + '/docs/form.json')).json();
    const docs = { review: await bytes('review.pdf'), form: { bytes: await bytes('form.pdf'), sigLine: meta.sigLine }, letter: await bytes('letter.pdf'), scan: await bytes('scan.pdf'), pack: await bytes('pack.pdf') };
    await story.shoot(p, docs);
    await finish(p);
    await sleep(800);
    await post('/ready', { job, errors: p.errors });
  } catch (e) {
    await post('/fail', { message: String(e && e.message || e), stack: String(e && e.stack || '') });
  }
})();
