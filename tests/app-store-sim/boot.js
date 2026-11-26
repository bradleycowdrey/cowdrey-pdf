// Put first in the <head> of the capture build only (inject.mjs here, run in CI before the Simulator build; the
// App Store build never has it). Before the app starts: the clock reads Wed Nov 25 2026, 9:41 AM, like the status
// bar; storage starts empty, as on a first launch; then it fetches the story player from run.mjs on the Mac and runs
// it. When the app cannot reach run.mjs from its own address, it loads the same bundle from run.mjs instead.
(function () {
  var SERVER = 'http://127.0.0.1:8737';
  // The app's clock, fixed like Playwright's in the browser capture (it keeps running from there).
  var RealDate = Date, shift = new RealDate(2026, 10, 25, 9, 41, 0).getTime() - RealDate.now();
  function FixedDate() {
    var a = Array.prototype.slice.call(arguments);
    if (!(this instanceof FixedDate)) return new RealDate(RealDate.now() + shift).toString();
    return a.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(a)))() : new RealDate(RealDate.now() + shift);
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = function () { return RealDate.now() + shift; };
  FixedDate.UTC = RealDate.UTC; FixedDate.parse = RealDate.parse;
  window.Date = FixedDate;
  // A first launch: nothing remembered from an earlier story.
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  // The player's pointers are not the system's, so pointer capture would refuse them: note the element instead.
  var set = Element.prototype.setPointerCapture, rel = Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture = function (id) { if (window.__storeCapture) window.__storeCapture(this); try { return set.call(this, id); } catch (e) {} };
  Element.prototype.releasePointerCapture = function (id) { if (window.__storeCapture) window.__storeCapture(null); try { return rel.call(this, id); } catch (e) {} };
  // Served by run.mjs (the fallback, when the app cannot reach the Mac from its own address): the app's native side
  // as far as the page asks at start, as in the browser capture.
  var web = location.protocol === 'http:';
  if (web && !window.__TAURI__) {
    window.__TAURI__ = { core: { invoke: function (c) { return Promise.resolve(c === 'take_opened_files' ? [] : null); } }, dialog: {}, event: { listen: function () { return Promise.resolve(function () {}); } }, opener: { openUrl: function () { return Promise.resolve(); } } };
  }
  var mode = web ? 'web' : 'app';
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
  fetch(SERVER + '/driver.js?mode=' + mode, ctl ? { signal: ctl.signal } : {}).then(function (r) {
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (code) {
    var go = function () { var s = document.createElement('script'); s.textContent = code; document.head.appendChild(s); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }).catch(function () {
    clearTimeout(timer);
    // The app's own address could not reach the Mac (the web view may block plain http from it): load the same
    // bundle from run.mjs instead, in this same web view.
    if (!web) location.replace(SERVER + '/app/index.html');
  });
})();
