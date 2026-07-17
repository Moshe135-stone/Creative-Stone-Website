document.getElementById('contactForm')?.addEventListener('submit', function (e) {
  e.preventDefault();

  // Record the whole submission — including the services picked on the grid
  // above (carried in via the hidden #servicesField) — into localStorage so
  // it's kept for whoever wires this form up to a real backend later.
  var data = {};
  new FormData(this).forEach(function (value, key) { data[key] = value; });
  try {
    localStorage.setItem('cs_last_submission', JSON.stringify(data));
  } catch (err) { /* private mode / storage disabled — non-fatal */ }

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

// Cursor-tracking blue spotlight: sets --mx/--my (consumed by the ::before /
// ::after radial-gradients in styles.css) to the pointer's position within the
// element, so the glow follows the mouse on hover. One handler drives every
// spotlit surface on the site — buttons, the hero CTAs, the tic-tac-toe
// service cells, and anything carrying the shared .noise-spot utility.
document.querySelectorAll(
  '.btn-nav-cta, .btn-primary, .btn-outline, .btn-dark, .hero-cta, .ttt__cell, .noise-spot'
).forEach(function (el) {
  el.addEventListener('pointermove', function (e) {
    var rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
    el.style.setProperty('--my', (e.clientY - rect.top) + 'px');
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

// Hero panel slide-over: as the hero rises up over the photo section, scrub
// its top corner radius from rounded (arriving from below) to flat (once it
// has scrolled up to fill the viewport), so it reads as a panel sliding over
// the previous section. See .hero-panel in styles.css.
(function () {
  var panel = document.querySelector('.hero-panel');
  if (!panel) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var MAX_RADIUS = 40; // px, while the panel is first arriving from below
  var ticking = false;

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function update() {
    var top = panel.getBoundingClientRect().top;
    var p = clamp(top / window.innerHeight); // 1 = arriving, 0 = pinned to top
    panel.style.setProperty('--slide-radius', (p * MAX_RADIUS) + 'px');
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

// Tic-tac-toe service board: scrubbed by scroll position through the tall
// #ttt section (see .ttt* in styles.css). While the board is pinned, progress
// runs 0→1: the grid frame first scales + fades in, then the nine service
// tokens drop into it one at a time (row-major). Hovering a cell is handled
// by the blue-noise spotlight below.
(function () {
  var section = document.getElementById('ttt');
  if (!section) return;

  var grid = section.querySelector('.ttt__grid');
  // Only the nine content cells get staggered in — the empty lattice cells
  // around them (built by the layout module below) stay put.
  var cells = Array.prototype.slice.call(section.querySelectorAll('.ttt__cell[data-service]'));
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

// Full-bleed lattice: size the grid to the pinned viewport and surround the
// nine content cells with empty filler cells, so the board fills the whole
// screen while the services stay grouped in a centred 3x3 block. Columns/rows
// are chosen to be odd (so the block centres exactly) and recomputed on resize.
(function () {
  var section = document.getElementById('ttt');
  if (!section) return;
  var pin = section.querySelector('.ttt__pin');
  var grid = section.querySelector('.ttt__grid');
  if (!pin || !grid) return;

  var content = Array.prototype.slice.call(grid.querySelectorAll('.ttt__cell[data-service]'));
  if (content.length !== 9) return;

  function layout() {
    var cs = getComputedStyle(pin);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var availW = pin.clientWidth - padX;
    var availH = pin.clientHeight - padY;
    // Reduced-motion / static pin can report a collapsed height — fall back to
    // a viewport-based estimate and pin the grid to it explicitly.
    if (availH < 320) availH = Math.max(320, window.innerHeight - padY);

    // Keep the lattice landscape — always wider than it is tall — by capping
    // its height to half its width, then centring it in the pinned viewport.
    var gridH = Math.min(availH, availW * 0.5);
    grid.style.height = gridH + 'px';

    // Target cell size: the 3x3 content block spans ~60% of the shorter side.
    var cell = Math.min(availW, gridH) / 5;
    cell = Math.max(88, Math.min(200, cell));

    // Cells read landscape — wider than tall. Widen the column target off the
    // same base while the row target keeps the base height, so each 1fr cell
    // lands with greater width than height.
    var CELL_ASPECT = 1.6;               // cell width : height
    var cellW = cell * CELL_ASPECT;
    var cellH = cell;

    var cols = Math.max(3, Math.round(availW / cellW));
    var rows = Math.max(3, Math.round(gridH / cellH));
    if (cols % 2 === 0) cols += 1;   // odd → perfectly centred block
    if (rows % 2 === 0) rows += 1;

    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';

    // Place the content block in the centre via explicit grid coordinates.
    var startCol = (cols - 3) / 2 + 1;
    var startRow = (rows - 3) / 2 + 1;
    content.forEach(function (cellEl, i) {
      cellEl.style.gridColumn = String(startCol + (i % 3));
      cellEl.style.gridRow = String(startRow + Math.floor(i / 3));
    });

    // Auto-flow empty filler cells fill every remaining slot.
    var need = cols * rows - content.length;
    var empties = grid.querySelectorAll('.ttt__cell--empty');
    var have = empties.length;
    if (have < need) {
      var frag = document.createDocumentFragment();
      for (var i = have; i < need; i++) {
        var e = document.createElement('div');
        e.className = 'ttt__cell ttt__cell--empty';
        e.setAttribute('aria-hidden', 'true');
        frag.appendChild(e);
      }
      grid.appendChild(frag);
    } else if (have > need) {
      for (var j = have - 1; j >= need; j--) empties[j].remove();
    }
  }

  layout();
  window.addEventListener('resize', layout, { passive: true });
})();

// Service picker: the tic-tac-toe cells double as a multi-select. Clicking a
// placed cell latches a persistent blue fill on it (see .ttt__cell.is-selected
// in styles.css), pushes its name into the fixed #svcTray rail, and mirrors the
// whole selection into the contact form's hidden #servicesField + #svcPicked
// summary. The choice is persisted in localStorage so it survives reloads and
// is there when the visitor reaches the form.
(function () {
  var STORAGE_KEY = 'cs_selected_services';
  var grid = document.querySelector('.ttt__grid');
  var tray = document.getElementById('svcTray');
  if (!grid || !tray) return;

  var cells = Array.prototype.slice.call(grid.querySelectorAll('.ttt__cell[data-service]'));
  var byService = {};
  cells.forEach(function (cell) { byService[cell.getAttribute('data-service')] = cell; });
  var validNames = cells.map(function (c) { return c.getAttribute('data-service'); });

  var list = document.getElementById('svcList');
  var count = document.getElementById('svcCount');
  var clearBtn = document.getElementById('svcClear');
  var field = document.getElementById('servicesField');
  var picked = document.getElementById('svcPicked');
  var pickedChips = picked ? picked.querySelector('.svc-picked__chips') : null;

  var selected = new Set();
  var revealed = false;

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(raw)) {
        raw.forEach(function (name) { if (validNames.indexOf(name) !== -1) selected.add(name); });
      }
    } catch (err) { /* ignore malformed / disabled storage */ }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered())); }
    catch (err) { /* non-fatal */ }
  }

  // Always emit names in grid order, so the tray/form read consistently.
  function ordered() {
    return validNames.filter(function (name) { return selected.has(name); });
  }

  function render() {
    var names = ordered();

    // Cell fills + a11y state.
    cells.forEach(function (cell) {
      var on = selected.has(cell.getAttribute('data-service'));
      cell.classList.toggle('is-selected', on);
      cell.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Tray list.
    if (list) {
      list.textContent = '';
      names.forEach(function (name) {
        var li = document.createElement('li');
        li.className = 'svc-tray__item';
        var label = document.createElement('span');
        label.textContent = name;
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove ' + name);
        rm.textContent = '×';
        rm.addEventListener('click', function () { deselect(name); });
        li.appendChild(label);
        li.appendChild(rm);
        list.appendChild(li);
      });
    }
    if (count) count.textContent = String(names.length);

    // Tray visibility.
    if (names.length > 0) {
      if (tray.hidden) { tray.hidden = false; revealed = true; }
      requestAnimationFrame(function () { tray.classList.add('is-open'); });
    } else {
      tray.classList.remove('is-open');
    }

    // Contact form mirror.
    if (field) field.value = names.join(', ');
    if (picked && pickedChips) {
      pickedChips.textContent = '';
      names.forEach(function (name) {
        var chip = document.createElement('span');
        chip.className = 'svc-picked__chip';
        chip.textContent = name;
        pickedChips.appendChild(chip);
      });
      picked.hidden = names.length === 0;
    }

    save();
  }

  function selectCell(cell) {
    var name = cell.getAttribute('data-service');
    cell.classList.add('is-placed');           // ensure the token shows if picked early
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    render();
  }
  function deselect(name) { selected.delete(name); render(); }

  cells.forEach(function (cell) {
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-pressed', 'false');
    cell.addEventListener('click', function () { selectCell(cell); });
    cell.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        selectCell(cell);
      }
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () { selected.clear(); render(); });
  }

  load();
  render();
})();

// Hero CTA dock: the two buttons ride the scroll in two steps (see
// .hero-cta-group in styles.css for the matching CSS).
//   1. .is-docked  — the moment their natural spot in the panel would carry
//      them above the bottom edge of the screen, they go fixed and stay flush
//      to that edge at full size. Handing over exactly at that crossing point
//      means the switch to fixed lands them where they already were, so there
//      is nothing to see.
//   2. .is-compact — once the hero panel itself has scrolled by, they shrink
//      to a small dock and follow you down the rest of the page.
// The slot keeps their height in the panel's flow, so going fixed can't make
// the layout jump.
(function () {
  var slot = document.querySelector('.hero-cta-slot');
  var panel = document.querySelector('.hero-panel');
  var group = slot && slot.querySelector('.hero-cta-group');
  if (!slot || !panel || !group) return;

  var ticking = false;

  // Reserve the row's height. Measured undocked, since a fixed group would
  // otherwise measure against a collapsed slot.
  function measure() {
    group.classList.remove('is-docked');
    slot.style.height = '';
    slot.style.height = group.offsetHeight + 'px';
  }

  function update() {
    ticking = false;
    var vh = window.innerHeight;
    group.classList.toggle('is-docked', slot.getBoundingClientRect().bottom <= vh);
    group.classList.toggle('is-compact', panel.getBoundingClientRect().bottom <= vh);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  function onResize() {
    measure();
    update();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  // Fonts landing late would change the row's height, so re-measure once ready.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  measure();
  update();
})();

// Range selector text: the hero statement, animated the way an After Effects
// text animator with a range selector would do it. The line is rebuilt as one
// span per character, and scrolling sweeps a soft-edged selector (FEATHER
// characters wide) across them from the first character to the last. Inside
// that band each character runs its own grey → white → blue ramp, so the sweep
// reads as a band of white light travelling along the line and leaving the
// brand blue behind it. Characters ahead of the band stay grey, characters
// behind it stay blue.
//
// The colors are only ever set here, so reduced motion (and no JS at all)
// simply leaves the plain white .range-text from styles.css alone.
(function () {
  var els = document.querySelectorAll('.range-text');
  if (!els.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var GREY = [90, 90, 99];
  var WHITE = [242, 242, 244];
  var BLUE = (function () {
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb');
    var parts = raw.split(',').map(function (v) { return parseInt(v, 10); });
    return parts.length === 3 && parts.every(function (v) { return v >= 0; }) ? parts : [56, 132, 255];
  })();
  // data-range="black" lines (the blue service panels) run a single light-grey
  // → near-black ramp instead of grey → white → blue, so the letters darken to
  // ink as the blue sheet wipes in behind them.
  var LIGHTGREY = [196, 196, 202];
  var BLACK = [10, 10, 12];

  var FEATHER = 8;      // width of the sweeping band, in characters
  var START = 0.88;     // sweep starts when the line's top is 88% down the viewport
  var END = 0.3;        // and finishes once it reaches 30%

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  // Wire one .range-text line: rebuild it as one span per character (grouped
  // into a span per word so words still wrap as units — the characters stay
  // real text nodes, so the sentence still reads normally), then return the
  // per-line update closure that drives its sweep on scroll.
  function setup(el) {
    var blackMode = el.dataset.range === 'black';
    var text = el.textContent.trim().replace(/\s+/g, ' ');
    var frag = document.createDocumentFragment();
    var chars = [];
    text.split(' ').forEach(function (word, wi) {
      if (wi) frag.appendChild(document.createTextNode(' '));
      var wordEl = document.createElement('span');
      wordEl.className = 'rt-word';
      word.split('').forEach(function (ch) {
        var charEl = document.createElement('span');
        charEl.className = 'rt-char';
        charEl.textContent = ch;
        wordEl.appendChild(charEl);
        chars.push(charEl);
      });
      frag.appendChild(wordEl);
    });
    el.textContent = '';
    el.appendChild(frag);

    var n = chars.length;
    var last = new Array(n).fill(-1);

    return function update() {
      var vh = window.innerHeight;
      var rect = el.getBoundingClientRect();
      var from = vh * START;
      var to = vh * END;
      var p = Math.min(1, Math.max(0, (from - rect.top) / (from - to)));

      // Leading edge of the selector, in character units. It starts one feather
      // before the first character and ends one feather past the last, so every
      // character gets the full ramp.
      var head = p * (n + FEATHER);

      for (var i = 0; i < n; i++) {
        var t = Math.min(1, Math.max(0, (head - i) / FEATHER));
        if (t === last[i]) continue;   // skip the characters the band has passed
        last[i] = t;
        var rgb = blackMode
          ? mix(LIGHTGREY, BLACK, t)
          : (t < 0.5 ? mix(GREY, WHITE, t * 2) : mix(WHITE, BLUE, (t - 0.5) * 2));
        chars[i].style.color = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      }
    };
  }

  var updaters = Array.prototype.map.call(els, setup);
  var ticking = false;

  function run() {
    ticking = false;
    updaters.forEach(function (u) { u(); });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(run);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  run();
})();

// Service slide panels: the solid-blue sheet wipes in from the left as each
// blue panel rises through the viewport. --wipe (0→1) retracts the dark
// .svc-slide__cover left→right, uncovering the panel's blue background, and the
// window here (START→END, keyed off the statement's position) matches the
// range-selector text sweep so the blue fills in right behind the darkening
// letters. --wipe defaults to 1 in CSS, so reduced motion / no JS just leaves
// the panels solid blue with no animation.
(function () {
  var panels = [].slice.call(document.querySelectorAll('.svc-slide--blue'));
  if (!panels.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var START = 0.9;   // wipe begins when the statement is 90% down the viewport
  var END = 0.38;    // and completes by 38%

  var items = panels.map(function (p) {
    return { el: p, title: p.querySelector('.svc-slide__title') || p };
  });
  items.forEach(function (it) { it.el.style.setProperty('--wipe', '0'); });

  var ticking = false;
  function run() {
    ticking = false;
    var vh = window.innerHeight;
    var from = vh * START;
    var to = vh * END;
    items.forEach(function (it) {
      var top = it.title.getBoundingClientRect().top;
      var p = Math.min(1, Math.max(0, (from - top) / (from - to)));
      it.el.style.setProperty('--wipe', p.toFixed(4));
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(run);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  run();
})();

// Magic scroll: drives the diagonal rail in the black & white photo section
// (see .magic-scroll in styles.css). Progress through the tall section maps to
// --focus — the rail slot currently centred — which runs from -1 (slot 0 still
// off the bottom-right) to N (the last slot gone past the top-left), so every
// item crosses the screen. Each item's scale/opacity comes from how far it is
// from centre, giving the pass-through-the-middle "focus" feel. Adding
// .magic-on is what switches the section out of its plain stacked fallback, so
// reduced motion simply leaves the fallback in place.
(function () {
  var section = document.querySelector('.magic-scroll');
  if (!section) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var rail = section.querySelector('.magic-scroll__rail');
  var items = [].slice.call(section.querySelectorAll('.magic-item'));
  if (!rail || !items.length) return;

  section.classList.add('magic-on');

  var n = items.length;
  var ticking = false;

  function update() {
    ticking = false;
    var rect = section.getBoundingClientRect();
    var distance = rect.height - window.innerHeight;
    if (distance <= 0) return;

    var p = Math.min(1, Math.max(0, -rect.top / distance));
    var focus = -1 + p * (n + 1);
    rail.style.setProperty('--focus', focus.toFixed(4));

    items.forEach(function (el, i) {
      // 0 at dead centre, 1 once ~1.4 slots away — by then the item is at the
      // corner of the screen, so it is fully faded and shrunk out.
      var d = Math.min(1, Math.abs(i - focus) / 1.4);
      el.style.setProperty('--s', (1 - d * 0.25).toFixed(4));
      el.style.setProperty('--o', (1 - d * d).toFixed(4));
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();

// Scroll reveal: anything marked .reveal (headings, cards and rows from "what
// we do" down) gets .revealed the first time it scrolls into view, which plays
// its CSS fade. rootMargin trims the bottom of the viewport so the fade starts
// once the element is comfortably in view rather than right at the edge.
(function () {
  var items = document.querySelectorAll('.reveal');
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
