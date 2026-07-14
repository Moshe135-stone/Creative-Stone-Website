document.getElementById('contactForm')?.addEventListener('submit', function (e) {
  e.preventDefault();
  this.style.display = 'none';
  document.getElementById('formSuccess').style.display = 'flex';
});

// Cursor-tracking spotlight on buttons: sets --mx/--my custom properties
// (consumed by the ::before radial-gradient in styles.css) to the pointer's
// position within the button, so the cyan glow follows the mouse on hover.
document.querySelectorAll('.btn-nav-cta, .btn-primary, .btn-outline, .btn-dark').forEach(function (btn) {
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

// Scale-up reveal for the black & white photo grid, triggered as each
// photo individually scrolls into view (see .photo-reveal in styles.css).
(function () {
  var photos = document.querySelectorAll('.photo-reveal');
  if (!photos.length) return;

  if (!('IntersectionObserver' in window)) {
    photos.forEach(function (el) { el.classList.add('revealed'); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });

  photos.forEach(function (el) { observer.observe(el); });
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
