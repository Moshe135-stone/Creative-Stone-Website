// Gradient metaballs shader for the intro landing section — moving,
// merging blobs of color (purple/violet, matching --accent) with a fine
// noise/grain overlay, rendered via a WebGL fragment shader on
// #metaball-canvas. Falls back to a static CSS gradient if WebGL is
// unavailable.
(function () {
  var canvas = document.getElementById('metaball-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    canvas.style.background = 'radial-gradient(circle at 50% 45%, #2a1f42 0%, #14101f 45%, #0a0a0c 75%)';
    return;
  }

  var vertexSrc = [
    'attribute vec2 aPos;',
    'void main() {',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var fragmentSrc = [
    'precision highp float;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    'uniform vec2 uMouse;', // pixel coords, WebGL (bottom-left origin) space — off-screen when not hovering
    'uniform vec2 uPush;', // uv-space cursor-velocity vector, decays toward 0 when the cursor stops
    '',
    '// hash-based pseudo-random grain, in the same spirit as the SVG',
    '// feTurbulence noise texture used elsewhere on the site (buttons).',
    'float hash(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    '',
    'float ball(vec2 uv, vec2 c, float r) {',
    '  return r / length(uv - c);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;',
    '  float t = uTime;',
    '  vec2 mouseUV = (uMouse - 0.5 * uResolution) / uResolution.y;',
    '',
    '  // Liquify: drag + swirl the sample point near the cursor, based on how',
    '  // fast/which way it has been moving (uPush), so the field visually',
    '  // gets pushed and stirred like liquid rather than just displaying a',
    '  // static bulge. Fades out with distance from the cursor and settles',
    '  // back to normal as uPush decays once the cursor stops (see JS below).',
    '  vec2 toMouse = uv - mouseUV;',
    '  float dMouse = length(toMouse);',
    '  float pushInfluence = smoothstep(0.55, 0.0, dMouse);',
    '  vec2 swirl = vec2(-toMouse.y, toMouse.x) * pushInfluence * length(uPush) * 3.0;',
    '  vec2 wuv = uv - uPush * pushInfluence * 2.5 + swirl;',
    '',
    '  float field = 0.0;',
    '  field += ball(wuv, vec2(sin(t * 0.32) * 0.55, cos(t * 0.26) * 0.32), 0.22);',
    '  field += ball(wuv, vec2(cos(t * 0.21) * 0.60, sin(t * 0.36) * 0.42), 0.26);',
    '  field += ball(wuv, vec2(sin(t * 0.41 + 2.1) * 0.42, cos(t * 0.19 + 1.3) * 0.50), 0.18);',
    '  field += ball(wuv, vec2(cos(t * 0.16 + 4.2) * 0.58, sin(t * 0.23 + 3.1) * 0.38), 0.24);',
    '  field += ball(wuv, vec2(sin(t * 0.29 + 1.6) * 0.38, cos(t * 0.33 + 2.6) * 0.48), 0.20);',
    '',
    '  float blob = smoothstep(0.85, 1.7, field);',
    '',
    '  vec3 base = vec3(0.039, 0.039, 0.047);', // near-black page background #0a0a0c
    '  vec3 mid = vec3(0.145, 0.388, 0.965);',  // vivid blue #2563f6
    '  vec3 hi = vec3(0.400, 0.650, 1.000);',   // lighter sky-blue highlight
    '',
    '  vec3 color = mix(base, mid, blob);',
    '  color = mix(color, hi, smoothstep(1.35, 2.3, field) * 0.65);',
    '',
    '  // soft concentric rings, slowly expanding outward from center and',
    '  // fading with distance so they read as a subtle halo, not a target.',
    '  float dist = length(uv);',
    '  float ringWave = sin(dist * 13.0 - t * 0.45) * 0.5 + 0.5;',
    '  float ringMask = smoothstep(0.82, 1.0, ringWave);',
    '  float ringFade = smoothstep(1.4, 0.05, dist);',
    '  color += hi * ringMask * ringFade * 0.30;',
    '',
    '  // black & white filter over the whole shader, with a soft circular',
    '  // spotlight around the cursor that reveals the blue underneath.',
    '  float luma = dot(color, vec3(0.299, 0.587, 0.114));',
    '  vec3 grayscale = vec3(luma);',
    '  float distMouse = length(uv - mouseUV);',
    '  float spotlight = smoothstep(0.42, 0.0, distMouse);',
    '  color = mix(grayscale, color, spotlight);',
    '',
    '  // subtle grain, in the same spirit as the noise texture on the buttons.',
    '  // A large time multiplier decorrelates the pattern frame to frame so',
    '  // it reads as flickering static rather than a slow-drifting texture.',
    '  float grain = (hash(gl_FragCoord.xy + t * 900.0) - 0.5) * 0.09;',
    '  color += grain;',
    '',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('metaball shader compile error:', gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  var program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('metaball shader link error:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  // Fullscreen quad (two triangles).
  var quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  var aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var uResolution = gl.getUniformLocation(program, 'uResolution');
  var uTime = gl.getUniformLocation(program, 'uTime');
  var uMouse = gl.getUniformLocation(program, 'uMouse');
  var uPush = gl.getUniformLocation(program, 'uPush');

  // Mouse position in WebGL fragment-coordinate space (origin bottom-left,
  // y increasing upward) — far off-screen by default so nothing is
  // revealed until the cursor actually hovers the canvas.
  var mouseX = -9999;
  var mouseY = -9999;

  // Velocity-based "push" vector, in uv-space (same normalization as the
  // shader's uv: pixel delta / canvas.height). Accumulates on movement,
  // decays every frame in the render loop so the liquify effect eases out
  // once the cursor stops instead of leaving a permanent bulge.
  var pushX = 0;
  var pushY = 0;

  function setMouseFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) * (canvas.width / rect.width);
    var py = canvas.height - (e.clientY - rect.top) * (canvas.height / rect.height); // flip: DOM is top-origin, WebGL is bottom-origin
    if (mouseX !== -9999) {
      pushX += (px - mouseX) / canvas.height;
      pushY += (py - mouseY) / canvas.height;
    }
    mouseX = px;
    mouseY = py;
  }

  canvas.addEventListener('pointermove', setMouseFromEvent);
  canvas.addEventListener('pointerleave', function () {
    mouseX = -9999;
    mouseY = -9999;
  });

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.round(canvas.clientWidth * dpr);
    var height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  var start = null;
  function frame(timestamp) {
    if (start === null) start = timestamp;
    resize();
    pushX *= 0.90;
    pushY *= 0.90;
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, (timestamp - start) / 1000);
    gl.uniform2f(uMouse, mouseX, mouseY);
    gl.uniform2f(uPush, pushX, pushY);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
