/* ============================================================================
   Creative Stone — interactive crystal logo
   ----------------------------------------------------------------------------
   Renders the crystal in real 3D next to the wordmark. It turns slowly on its
   own; on hover a band of light sweeps across its faces and sparkles flare on
   the surface. The crystal also leans slightly toward the cursor.

   You should not need to edit this file. All the dials worth touching live in
   the SETTINGS block directly below.
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const VERSION = 'v4 — sparkle size fix';
console.log('[crystal-logo]', VERSION);

const SETTINGS = {
  // How many seconds one full turn takes. Smaller = faster spin.
  secondsPerTurn: 6,

  // How brightly the crystal glows. 0 = lit only by the lights, 1 = very bright.
  glowIdle:  0.55,
  glowHover: 0.95,

  // The hover light-sweep.
  sweepDurationMs: 750,   // how long one sweep takes
  sweepRepeatMs:  1250,   // how often it repeats while the cursor stays on it
  sweepWidth:     0.16,   // thinner number = tighter, sharper streak

  // Sparkles.
  sparkleCount: 26,
  sparkleSize:  26,

  // How far the crystal leans toward the cursor, in radians. 0 disables it.
  tiltAmount: 0.22,

  // Resting tilt so the faces always catch some light.
  restTilt: -0.14,

  // How much of its frame the crystal fills. 1 = edge to edge (will clip on
  // the widest part of the spin). 0.94 is snug with a hair of breathing room.
  fill: 0.94,

  // Edge glow on hover. This lives on the crystal's own silhouette, so it
  // can never spill into a rectangle. 0 turns it off.
  rimHover: 0.85,

  // The canvas hangs over its layout slot by this factor (must match the
  // 170% in crystal-logo.css) so nothing gets sliced at the canvas edge.
  overscan: 1.7,
};

/* -------------------------------------------------------------------------- */

const PI2 = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function createCrystalLogo(container) {
  const modelUrl = container.dataset.model || 'crystal.glb';

  const prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- renderer ---------- */
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,               // transparent background: sits on any page colour
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('crystal-logo__canvas');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  /* ---------- lights (mirrors the Blender rig) ---------- */
  scene.add(new THREE.AmbientLight(0x2a3f66, 0.6));

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-1.8, 2.6, 3.2);
  scene.add(key);

  const blue = new THREE.PointLight(0x0047ff, 26, 0, 2);
  blue.position.set(-2.6, -1.8, 2.4);
  scene.add(blue);

  const cyan = new THREE.PointLight(0x1ae5ff, 16, 0, 2);
  cyan.position.set(2.4, 1.9, 2.6);
  scene.add(cyan);

  const back = new THREE.PointLight(0x2a6bff, 12, 0, 2);
  back.position.set(0, 0.4, -3.2);
  scene.add(back);

  /* ---------- shared shader values ---------- */
  const uniforms = {
    uGleam: { value: 0 },        // 0..1 strength of the sweep
    uSweep: { value: -1.5 },     // where the band currently sits
    uGlow:  { value: SETTINGS.glowIdle },
    uAxis:  { value: new THREE.Vector2(0.7, 0.7) }, // sweep direction
    uRim:   { value: 0 },        // edge glow, hugs the silhouette
  };

  const group = new THREE.Group();
  scene.add(group);

  let crystal = null;
  let sparkles = null;
  let modelSize = null;

  /* ---------- material ---------- */
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,          // the colour gradient baked in Blender
    metalness: 0.0,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.65,
    iridescence: 0.28,
    iridescenceIOR: 1.32,
    side: THREE.FrontSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGleam = uniforms.uGleam;
    shader.uniforms.uSweep = uniforms.uSweep;
    shader.uniforms.uGlow  = uniforms.uGlow;
    shader.uniforms.uAxis  = uniforms.uAxis;
    shader.uniforms.uRim   = uniforms.uRim;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vObjPos;',
        'uniform float uGleam;',
        'uniform float uSweep;',
        'uniform float uGlow;',
        'uniform float uRim;',
        'uniform vec2  uAxis;',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        // steady glow taken from the baked vertex-colour gradient
        'totalEmissiveRadiance += vColor.rgb * uGlow;',

        /* The gleam is a light panning across the crystal, not a painted
           stripe. Each facet flares only when its actual angle lines up
           with the moving light - the same way a real gem catches sun. */
        'vec3 _V = normalize(vViewPosition);',
        'vec3 _L = normalize(vec3(uAxis.x * uSweep * 2.2, uAxis.y * uSweep * 2.2 + 0.35, 0.9));',
        'vec3 _H = normalize(_L + _V);',
        'float _NdH = clamp(dot(normalize(normal), _H), 0.0, 1.0);',
        // sharp core = the glint, broad base = soft bloom around it
        'float _glint = pow(_NdH, 90.0) * 2.6 + pow(_NdH, 14.0) * 0.5;',
        'totalEmissiveRadiance += vec3(0.85, 0.94, 1.0) * _glint * uGleam;',

        // edge glow that follows the real silhouette - never a rectangle
        'float _fres = pow(1.0 - clamp(dot(normalize(normal), _V), 0.0, 1.0), 3.0);',
        'totalEmissiveRadiance += vec3(0.30, 0.72, 1.0) * _fres * uRim;',
      ].join('\n'));
  };

  /* ---------- sparkles ---------- */
  function buildSparkles(geometry) {
    const src = geometry.attributes.position;
    const n = Math.min(SETTINGS.sparkleCount, src.count);
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);

    const used = new Set();
    for (let i = 0; i < n; i++) {
      let idx;
      do { idx = Math.floor(Math.random() * src.count); } while (used.has(idx));
      used.add(idx);
      pos[i * 3 + 0] = src.getX(idx) * 1.02;
      pos[i * 3 + 1] = src.getY(idx) * 1.02;
      pos[i * 3 + 2] = src.getZ(idx) * 1.02;
      phase[i] = Math.random();
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:    { value: 0 },
        uSize:    { value: SETTINGS.sparkleSize },
        uOpacity: { value: 0 },
      },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        uniform float uSize;
        varying float vTw;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float tw = pow(max(0.0, sin(uTime * 3.4 + aPhase * 6.28318)), 8.0);
          vTw = tw;
          // sized so a sparkle is ~uSize px at the camera's working distance,
          // and hard-capped so one can never balloon across the canvas
          gl_PointSize = min(uSize * tw * (6.0 / max(0.001, -mv.z)), 34.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vTw;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          float core = max(0.0, 1.0 - r);
          float flare = max(0.0, 1.0 - abs(p.x) * 9.0)
                      + max(0.0, 1.0 - abs(p.y) * 9.0);
          float a = pow(core, 2.0) * 0.55 + flare * core * 0.95;
          a *= vTw * uOpacity;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(vec3(0.88, 0.96, 1.0), a);
        }
      `,
    });

    return new THREE.Points(g, m);
  }

  /* ---------- load the model ---------- */
  let ready = false;
  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      let mesh = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) {
        console.error('[crystal-logo] no mesh found inside', modelUrl);
        return;
      }

      const geo = mesh.geometry;
      geo.computeBoundingBox();
      geo.center();                       // pivot dead centre so it spins true

      crystal = new THREE.Mesh(geo, material);
      group.add(crystal);

      sparkles = buildSparkles(geo);
      group.add(sparkles);

      modelSize = new THREE.Vector3();
      geo.boundingBox.getSize(modelSize);
      fitToFrame();

      ready = true;
      container.classList.add('is-ready');
    },
    undefined,
    (err) => console.error('[crystal-logo] could not load', modelUrl, err)
  );

  /* ---------- pointer state ---------- */
  let hover = 0, hoverTarget = 0;
  let px = 0, py = 0;               // cursor, -1..1 inside the container
  let sweepStart = -Infinity;

  const startSweep = () => { sweepStart = performance.now(); };

  container.addEventListener('pointerenter', () => {
    hoverTarget = 1;
    startSweep();
  });
  container.addEventListener('pointerleave', () => {
    hoverTarget = 0;
    px = py = 0;
  });
  container.addEventListener('pointermove', (e) => {
    const r = container.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width) * 2 - 1;
    py = ((e.clientY - r.top) / r.height) * 2 - 1;
    // the streak runs along the direction of the cursor.
    // guard against a zero-length vector, which would make the shader NaN
    const len = Math.hypot(px, py);
    if (len > 0.001) uniforms.uAxis.value.set(px / len, -py / len);
  });

  // keyboard users get the same treatment
  container.addEventListener('focusin', () => { hoverTarget = 1; startSweep(); });
  container.addEventListener('focusout', () => { hoverTarget = 0; });

  /* ---------- sizing ----------
     Scales the crystal so it nearly fills its frame at any container size.
     Uses the widest footprint it reaches mid-spin, so it never clips as it
     turns, and leaves no dead canvas padding pushing the wordmark away.     */
  function fitToFrame() {
    if (!modelSize) return;
    const visH = 2 * camera.position.z *
                 Math.tan((camera.fov * Math.PI) / 360);
    const visW = visH * camera.aspect;
    const spinFootprint = Math.max(modelSize.x, modelSize.z);
    // divide by the canvas overscan so the crystal's VISIBLE size still
    // fills `fill` of the layout slot, not of the oversized canvas
    const fillEff = SETTINGS.fill / SETTINGS.overscan;
    const s = Math.min(
      (visH * fillEff) / modelSize.y,
      (visW * fillEff) / spinFootprint
    );
    group.scale.setScalar(s);
  }

  /* ---------- resize ---------- */
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitToFrame();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /* ---------- only run while visible ---------- */
  let onScreen = true;
  const io = new IntersectionObserver(
    ([entry]) => { onScreen = entry.isIntersecting; },
    { threshold: 0 }
  );
  io.observe(container);

  /* ---------- frame loop ---------- */
  let last = performance.now();
  let spin = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!ready || !onScreen) { last = now; return; }

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    hover = lerp(hover, hoverTarget, 1 - Math.pow(0.001, dt));

    if (!prefersReducedMotion) {
      spin += dt * (PI2 / SETTINGS.secondsPerTurn);
    }
    group.rotation.y = spin;
    group.rotation.x = lerp(
      group.rotation.x,
      SETTINGS.restTilt + py * SETTINGS.tiltAmount * hover,
      1 - Math.pow(0.005, dt)
    );
    group.rotation.z = lerp(
      group.rotation.z,
      -px * SETTINGS.tiltAmount * 0.4 * hover,
      1 - Math.pow(0.005, dt)
    );

    // glow + silhouette rim
    uniforms.uGlow.value = lerp(SETTINGS.glowIdle, SETTINGS.glowHover, hover);
    uniforms.uRim.value  = hover * SETTINGS.rimHover;

    // sweep
    const t = (now - sweepStart) / SETTINGS.sweepDurationMs;
    if (t >= 0 && t <= 1) {
      uniforms.uSweep.value = lerp(-1.5, 1.5, easeOutCubic(t));
      uniforms.uGleam.value = Math.sin(Math.PI * t);
    } else {
      uniforms.uGleam.value = lerp(uniforms.uGleam.value, 0, 0.2);
      if (hoverTarget === 1 && now - sweepStart > SETTINGS.sweepRepeatMs) startSweep();
    }

    if (sparkles) {
      sparkles.material.uniforms.uTime.value = now / 1000;
      sparkles.material.uniforms.uOpacity.value = clamp01(hover * 1.1);
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  /* ---------- tidy up ---------- */
  return {
    destroy() {
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
      material.dispose();
      if (crystal) crystal.geometry.dispose();
      if (sparkles) { sparkles.geometry.dispose(); sparkles.material.dispose(); }
      renderer.domElement.remove();
    },
  };
}

/* auto-start every element marked data-crystal-logo */
document.querySelectorAll('[data-crystal-logo]').forEach(createCrystalLogo);
