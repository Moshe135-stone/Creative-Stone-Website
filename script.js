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

// Cursor-tracking spotlight on buttons and the tic-tac-toe service cells:
// sets --mx/--my custom properties (consumed by the ::before radial-gradient
// in styles.css) to the pointer's position within the element, so the glow
// follows the mouse on hover — cyan/purple on the buttons, blue on the cells.
document.querySelectorAll('.btn-nav-cta, .btn-primary, .btn-outline, .btn-dark, .hero-cta, .ttt__cell').forEach(function (btn) {
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

// Tic-tac-toe service board: scrubbed by scroll position through the tall
// #ttt section (see .ttt* in styles.css). While the board is pinned, progress
// runs 0→1: the grid frame first scales + fades in, then the nine service
// tokens drop into it one at a time (row-major). Hovering a cell is handled
// by the blue-noise spotlight below.
(function () {
  var section = document.getElementById('ttt');
  if (!section) return;

  var grid = section.querySelector('.ttt__grid');
  var cells = Array.prototype.slice.call(section.querySelectorAll('.ttt__cell'));
  if (!cells.length) return;

  var GRID_IN = 0.14;      // grid frame finishes appearing at 14% of the scroll
  var PLACE_START = 0.16;  // tokens then drop in...
  var PLACE_END = 0.85;    // ...finishing near the end
  var ticking = false;

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return t * t * (3 - 2 * t); } // smoothstep

  // Reduced motion: no pin/scrub — show the finished board and bail.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cells.forEach(function (cell) { cell.classList.add('is-placed'); });
    return;
  }

  function update() {
    var rect = section.getBoundingClientRect();
    var travel = rect.height - window.innerHeight;
    var progress = travel > 0 ? clamp(-rect.top / travel) : 0;

    var gridIn = ease(clamp(progress / GRID_IN));
    if (grid) {
      grid.style.opacity = gridIn;
      grid.style.transform = 'scale(' + (0.85 + 0.15 * gridIn) + ')';
    }

    cells.forEach(function (cell, i) {
      var threshold = PLACE_START + (i / cells.length) * (PLACE_END - PLACE_START);
      cell.classList.toggle('is-placed', progress >= threshold);
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

// Smooth fade-in for the black & white photo grid: each line of copy and each
// framed photo gets .revealed the first time it scrolls into view, which
// triggers the CSS opacity/transform transition (see .photo-reveal in
// styles.css). rootMargin trims the bottom of the viewport so the fade starts
// once the element is comfortably in view rather than right at the edge.
(function () {
  var items = document.querySelectorAll('.photo-reveal');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('revealed'); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -12% 0px' });

  items.forEach(function (el) { observer.observe(el); });
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
