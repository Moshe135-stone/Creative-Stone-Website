document.getElementById('contactForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  this.style.display = 'none';
  document.getElementById('formSuccess').style.display = 'flex';
});

// Burger menu: toggles #siteHeader.nav-open, which drives the horizontal
// right-to-left fan-out of .nav-item links and the burger-to-X morph (see
// styles.css). Clicking a link closes the menu again.
(function () {
  var header = document.getElementById('siteHeader');
  var toggle = document.getElementById('navToggle');
  if (!header || !toggle) return;

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', function () {
    setOpen(!header.classList.contains('nav-open'));
  });

  header.querySelectorAll('.nav-item').forEach(function (link) {
    link.addEventListener('click', function () { setOpen(false); });
  });
})();

// Cursor-tracking spotlight on buttons: sets --mx/--my custom properties
// (consumed by the ::before radial-gradient in styles.css) to the pointer's
// position within the button, so the cyan glow follows the mouse on hover.
document.querySelectorAll('.btn-nav-cta, .btn-primary, .btn-outline, .btn-dark, .hero-cta').forEach(function (btn) {
  btn.addEventListener('pointermove', function (e) {
    var rect = btn.getBoundingClientRect();
    btn.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
    btn.style.setProperty('--my', (e.clientY - rect.top) + 'px');
  });
});

// Dissolve the giant "CREATIVE STONE" intro title as soon as the user
// starts scrolling — drives the --dissolve custom property (0 to 1) that
// the inline opacity/filter/transform calc() expressions on #intro-title
// read from (see index.html).
(function () {
  var introTitle = document.getElementById('intro-title');
  if (!introTitle) return;

  var DISSOLVE_DISTANCE = 420; // px of scroll for a full dissolve
  var ticking = false;

  function updateDissolve() {
    var progress = Math.min(window.scrollY / DISSOLVE_DISTANCE, 1);
    introTitle.style.setProperty('--dissolve', progress);
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(updateDissolve);
      ticking = true;
    }
  }, { passive: true });

  updateDissolve();
})();

// Tic-tac-toe service board: scrubbed entirely by scroll position through
// the tall #ttt section (see .ttt* in styles.css). As the board is pinned,
// progress runs 0→1; the first ~66% places the nine service tokens one at a
// time (row-major, so the last one placed completes the winning diagonal),
// and the tail draws the diagonal strike by scaling --strike from 0 to 1.
(function () {
  var section = document.getElementById('ttt');
  if (!section) return;

  var cells = Array.prototype.slice.call(section.querySelectorAll('.ttt__cell'));
  var winCells = section.querySelectorAll('.ttt__cell--win');
  var strikeEl = section.querySelector('.ttt__strike');
  if (!cells.length || !strikeEl) return;

  var PLACE_END = 0.66;   // last token lands at 66% of the scroll-through
  var STRIKE_FROM = 0.72; // strike starts drawing just after
  var STRIKE_SPAN = 0.2;  // ...and finishes over the next 20%
  var ticking = false;

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function update() {
    var rect = section.getBoundingClientRect();
    var travel = rect.height - window.innerHeight;
    var progress = travel > 0 ? clamp(-rect.top / travel) : 0;

    cells.forEach(function (cell, i) {
      var threshold = ((i + 1) / cells.length) * PLACE_END;
      cell.classList.toggle('is-placed', progress >= threshold);
    });

    var strike = clamp((progress - STRIKE_FROM) / STRIKE_SPAN);
    strikeEl.style.setProperty('--strike', strike);
    for (var j = 0; j < winCells.length; j++) {
      winCells[j].classList.toggle('is-won', strike > 0.5);
    }

    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });

  update();
})();

// Scroll-linked reveal for the black & white photo grid: each line of copy
// and each framed photo rises and fades into place as it scrolls up through
// the viewport, scrubbed continuously by scroll position rather than firing
// once on entry (see .photo-reveal in styles.css). Reduced motion / no JS
// leaves the grid in its natural, fully-visible state.
(function () {
  var items = Array.prototype.slice.call(document.querySelectorAll('.photo-reveal'));
  if (!items.length) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ticking = false;

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function update() {
    var ih = window.innerHeight;
    var start = ih * 0.9;   // starts revealing as the element nears the bottom edge
    var end = ih * 0.55;    // fully revealed once it rises just past centre
    items.forEach(function (el) {
      var top = el.getBoundingClientRect().top;
      var p = clamp((start - top) / (start - end));
      // Photo tiles scale up noticeably as they scroll in; the text lines
      // just get a subtle settle so the words stay readable.
      var minScale = el.classList.contains('photo-spotlight') ? 0.7 : 0.94;
      el.style.opacity = p;
      el.style.transform = 'translateY(' + ((1 - p) * 64) + 'px) scale(' + (minScale + (1 - minScale) * p) + ')';
    });
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });

  update();
})();

// Sparkle color-reveal spotlight on the B&W photo grid: same --mx/--my
// pointer-tracking technique as the button spotlight, but here it drives
// the mask-image on .photo-bw-mask (see styles.css) so hovering reveals
// the color "sparkle" photo underneath through a soft circular hole.
document.querySelectorAll('.photo-spotlight').forEach(function (tile) {
  tile.addEventListener('pointermove', function (e) {
    var rect = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
    tile.style.setProperty('--my', (e.clientY - rect.top) + 'px');
  });
  tile.addEventListener('pointerleave', function () {
    tile.style.setProperty('--mx', '-9999px');
    tile.style.setProperty('--my', '-9999px');
  });
});
