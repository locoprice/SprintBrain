// ── SPRINTBRAIN SHARED TOOLTIP (Avada style) ──────────────────────
// Canonical vanilla implementation. Loaded by extension/popup/popup.html and
// Sprintbrain.html. The mobile app and the landing site inline a copy of this
// file because neither can reach extension/ at runtime: /mobile/ is a
// single-file app by design, and the landing site is a separate Netlify site
// rooted at app/public/landing/. Keep the three in sync; the React dashboard
// carries the same values in app/src/components/ui/tooltip.tsx.
//
// Values are Avada's, read off a live theme-fusion tooltip. The documentation
// publishes the option list but no CSS. Canonical table: docs/DESIGN_SYSTEM.md.
//   box    max-width 200px; padding 3px 8px; radius 4px; text-align center
//   colour background rgba(33,33,33,.97); text #D1D1D2
//   type   font-size 12px; line-height 1.4
//   show   opacity .9; transition opacity .3s linear
//   arrow  5px solid triangle in the box colour
//
// Any element carrying a `title` is upgraded on hover: the attribute is moved
// to `data-sb-tip` so the browser's own tooltip never appears. Nothing has to
// be tagged by hand, and elements rendered later work for free because the
// listeners are delegated on the document. Opt out with `data-sb-tip-skip`.
// Force a side with `data-sb-tip-pos="top|bottom|left|right"`.

(function () {
  'use strict';

  if (typeof document === 'undefined' || window.__sbTooltipReady) return;
  window.__sbTooltipReady = true;

  var BG = 'rgba(33, 33, 33, 0.97)';
  var FG = 'rgb(209, 209, 210)';
  var GAP = 5;   // arrow height, the space Avada keeps between box and trigger
  var NUDGE = 3; // Avada's per-side margin

  // `title` on these is an accessibility label, not a hint. Converting it would
  // strip the label and hand back nothing.
  var SKIP = { IFRAME: 1, SVG: 1, TITLE: 1, LINK: 1, ABBR: 1 };

  var tip = null;
  var box = null;
  var arrow = null;
  var current = null;

  function injectCss() {
    if (document.getElementById('sb-tooltip-css')) return;
    var css =
      '.sb-tip{position:fixed;z-index:2030;font-size:12px;line-height:1.4;' +
      'opacity:0;transition:opacity .3s linear;pointer-events:none;' +
      'width:max-content;max-width:200px}' +
      '.sb-tip.sb-tip-in{opacity:.9}' +
      '.sb-tip-box{max-width:200px;padding:3px 8px;color:' + FG + ';' +
      'text-align:center;text-decoration:none;background-color:' + BG + ';' +
      'border-radius:4px;background-clip:padding-box}' +
      '.sb-tip-arrow{position:absolute;width:0;height:0;' +
      'border-color:transparent;border-style:solid}' +
      '@media (prefers-reduced-motion: reduce){.sb-tip{transition:none}}';
    var s = document.createElement('style');
    s.id = 'sb-tooltip-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function build() {
    if (tip) return;
    injectCss();
    tip = document.createElement('div');
    tip.className = 'sb-tip';
    tip.setAttribute('role', 'tooltip');
    box = document.createElement('div');
    box.className = 'sb-tip-box';
    arrow = document.createElement('span');
    arrow.className = 'sb-tip-arrow';
    tip.appendChild(box);
    tip.appendChild(arrow);
    document.body.appendChild(tip);
  }

  var OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  var EDGE = 4;

  function fits(r, w, h, pos) {
    if (pos === 'bottom') return r.bottom + GAP + NUDGE + h <= (window.innerHeight || 0) - EDGE;
    if (pos === 'left')   return r.left - w - GAP - NUDGE >= EDGE;
    if (pos === 'right')  return r.right + GAP + NUDGE + w <= (window.innerWidth || 0) - EDGE;
    return r.top - h - GAP - NUDGE >= EDGE;
  }

  // Flip to the opposite side when the wanted one has no room, the way every
  // Bootstrap-derived tooltip does. Clamping instead would keep the box on
  // screen but drop it on top of the element it is describing, which is what
  // happens to anything triggered from a header near the top edge.
  function resolvePos(r, w, h, want) {
    if (fits(r, w, h, want)) return want;
    var alt = OPPOSITE[want] || 'bottom';
    return fits(r, w, h, alt) ? alt : want;
  }

  // Place the box, then pull it back inside the viewport if it would still hang
  // off an edge. A hint the user cannot read is worse than a shifted one.
  function place(el, want) {
    var r = el.getBoundingClientRect();
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var pos = resolvePos(r, w, h, want);
    var left, top;

    if (pos === 'bottom')      { left = r.left + r.width / 2 - w / 2; top = r.bottom + GAP + NUDGE; }
    else if (pos === 'left')   { left = r.left - w - GAP - NUDGE;     top = r.top + r.height / 2 - h / 2; }
    else if (pos === 'right')  { left = r.right + GAP + NUDGE;        top = r.top + r.height / 2 - h / 2; }
    else                       { left = r.left + r.width / 2 - w / 2; top = r.top - h - GAP - NUDGE; }

    var maxL = (window.innerWidth || 0) - w - EDGE;
    if (left > maxL) left = maxL;
    if (left < EDGE) left = EDGE;
    var maxT = (window.innerHeight || 0) - h - EDGE;
    if (top > maxT) top = maxT;
    if (top < EDGE) top = EDGE;

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    placeArrow(r, left, top, w, h, pos);
  }

  // The arrow stays on the trigger even after the box has been nudged sideways,
  // so it still points at what it describes.
  function placeArrow(r, left, top, w, h, pos) {
    var s = arrow.style;
    s.top = s.right = s.bottom = s.left = '';
    s.marginLeft = s.marginTop = '';
    s.borderWidth = '';
    s.borderTopColor = s.borderRightColor = s.borderBottomColor = s.borderLeftColor = 'transparent';

    var cx = r.left + r.width / 2 - left;
    var cy = r.top + r.height / 2 - top;
    var clamp = function (v, max) { return Math.max(GAP, Math.min(v, max - GAP)); };

    if (pos === 'bottom') {
      s.borderWidth = '0 ' + GAP + 'px ' + GAP + 'px';
      s.borderBottomColor = BG;
      s.top = -GAP + 'px';
      s.left = Math.round(clamp(cx, w) - GAP) + 'px';
    } else if (pos === 'left') {
      s.borderWidth = GAP + 'px 0 ' + GAP + 'px ' + GAP + 'px';
      s.borderLeftColor = BG;
      s.right = -GAP + 'px';
      s.top = Math.round(clamp(cy, h) - GAP) + 'px';
    } else if (pos === 'right') {
      s.borderWidth = GAP + 'px ' + GAP + 'px ' + GAP + 'px 0';
      s.borderRightColor = BG;
      s.left = -GAP + 'px';
      s.top = Math.round(clamp(cy, h) - GAP) + 'px';
    } else {
      s.borderWidth = GAP + 'px ' + GAP + 'px 0';
      s.borderTopColor = BG;
      s.bottom = -GAP + 'px';
      s.left = Math.round(clamp(cx, w) - GAP) + 'px';
    }
  }

  function show(el) {
    var text = el.getAttribute('data-sb-tip');
    if (!text) return;
    build();
    current = el;
    box.textContent = text;
    tip.style.left = '-9999px';
    tip.style.top = '-9999px';
    tip.classList.add('sb-tip-in');
    place(el, el.getAttribute('data-sb-tip-pos') || 'top');
  }

  function hide() {
    current = null;
    if (tip) tip.classList.remove('sb-tip-in');
  }

  // Move `title` out of the browser's reach the moment the pointer arrives, so
  // the native bubble never gets a chance to render alongside ours.
  function adopt(el) {
    if (!el || el.hasAttribute('data-sb-tip-skip')) return null;
    if (SKIP[el.tagName]) return null;
    var t = el.getAttribute('title');
    if (t !== null && t !== '') {
      el.setAttribute('data-sb-tip', t);
      el.removeAttribute('title');
    }
    return el.getAttribute('data-sb-tip') ? el : null;
  }

  function target(node) {
    if (!node || !node.closest) return null;
    return node.closest('[title],[data-sb-tip]');
  }

  document.addEventListener('mouseover', function (e) {
    var el = adopt(target(e.target));
    if (el && el !== current) show(el);
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (current && target(e.target) === current) hide();
  }, true);

  document.addEventListener('focusin', function (e) {
    var el = adopt(target(e.target));
    if (el) show(el);
  }, true);

  document.addEventListener('focusout', hide, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  }, true);

  // A tooltip anchored to something that has scrolled away points at nothing.
  window.addEventListener('scroll', function () {
    if (current) place(current, current.getAttribute('data-sb-tip-pos') || 'top');
  }, true);
  window.addEventListener('resize', function () {
    if (current) place(current, current.getAttribute('data-sb-tip-pos') || 'top');
  });
}());
