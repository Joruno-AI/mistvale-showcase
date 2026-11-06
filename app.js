/* =========================================================================
   MISTVALE — a small world suspended in a glass cube in deep space
   Three.js · procedural clay landscape · custom water, glass & tilt-shift
   ========================================================================= */
(async function () {
  'use strict';

  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 40)));

  const TAU = Math.PI * 2;
  const canvas = document.getElementById('world');
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

  /* -------------------------------------------------------------------------
     Wind — a tiny shared vertex-shader modifier so grass, leaves and branches
     all breathe with the same gusts. Works on instanced standard materials.
     ------------------------------------------------------------------------- */
  const windTime = { value: 0 };
  function addWind(material, options) {
    const o = options || {};
    const strength = o.strength ?? 0.02;
    const yBias = o.yBias ?? 0.0;
    const freq = o.freq ?? 1.0;
    const curl = o.curl ?? 0.7;
    const space = o.space ?? 0.82;
    const key = 'wind-' + strength + '-' + yBias + '-' + freq + '-' + curl + '-' + space + '-' + (o.phase ?? 0) + '-' + (o.leaf ? 'leaf' : 'std');
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windTime;
      shader.uniforms.uWindStrength = { value: strength };
      shader.vertexShader = 'uniform float uWindTime;\nuniform float uWindStrength;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windOrigin = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
        #else
          vec3 windOrigin = vec3(0.0);
        #endif
        float windPhase = uWindTime * ${freq.toFixed(3)} + windOrigin.x * ${space.toFixed(2)} + windOrigin.z * ${(space * 0.7).toFixed(2)} + ${(o.phase ?? 0).toFixed(2)};
        float windGust = 0.62 + 0.38 * sin(uWindTime * 0.42 + windOrigin.x * 0.17 + windOrigin.z * 0.11);
        float windBend = max(transformed.y - ${yBias.toFixed(4)}, 0.0);
        windBend *= windBend;
        transformed.x += sin(windPhase) * uWindStrength * windBend * windGust;
        transformed.z += cos(windPhase * ${curl.toFixed(2)} + 1.27) * uWindStrength * windBend * windGust * 0.72;
      `);
      if (o.leaf) {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 leafOrigin = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
          #else
            vec3 leafOrigin = vec3(0.0);
          #endif
          float rustle = uWindTime * 1.15 + leafOrigin.x * 0.32 + leafOrigin.z * 0.24;
          transformed.x += sin(rustle) * 0.035;
          transformed.z += cos(rustle * 0.83 + 1.2) * 0.024;
          transformed.y += sin(rustle * 1.7 + 0.6) * 0.008;
        `);
      }
    };
    material.customProgramCacheKey = () => key;
    material.needsUpdate = true;
    return material;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
  } catch (err) {
    document.getElementById('fallback').style.display = 'grid';
    document.getElementById('loader').style.display = 'none';
    return;
  }

  const IS_MOBILE = window.matchMedia('(max-width: 760px)').matches;
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_DPR = IS_MOBILE ? 1.5 : 1.75;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1116, 0.0125);

  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 160);
  camera.position.set(19, 17, 22);

  /* -------------------------------------------------------------------------
     Quality helpers
     ------------------------------------------------------------------------- */
  const rand = (() => {
    let a = 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const randRange = (a, b) => a + (b - a) * rand();

  function hash2(x, z) {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf);
    const v = zf * zf * (3 - 2 * zf);
    const a = hash2(xi, zi), b = hash2(xi + 1, zi);
    const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, z, octaves) {
    let value = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      value += vnoise(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return value / norm;
  }

  /* -------------------------------------------------------------------------
     The landscape is defined analytically so the whole miniature world is
     deterministic: terrain, river, lake, forest and tiny inhabitants all use
     the same height field.
     ------------------------------------------------------------------------- */
  const CUBE = { half: 4.88, bottom: -0.92, top: 9.08 };
  CUBE.height = CUBE.top - CUBE.bottom;
  CUBE.centerY = (CUBE.top + CUBE.bottom) * 0.5;

  const PEAKS = [
    { x: -1.42, z: -1.52, rx: 1.78, rz: 1.82, h: 3.46, p: 1.24 },
    { x: -2.54, z: -1.90, rx: 1.34, rz: 1.34, h: 2.35, p: 1.12 },
    { x: 0.66, z: -2.10, rx: 1.56, rz: 1.48, h: 2.22, p: 1.18 },
    { x: -0.58, z: -2.94, rx: 1.44, rz: 1.10, h: 1.52, p: 1.0 }
  ];

  const riverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.30, 0, -2.10),
    new THREE.Vector3(-1.53, 0, -1.62),
    new THREE.Vector3(-1.28, 0, -1.15),
    new THREE.Vector3(-0.67, 0, -0.87),
    new THREE.Vector3(-0.02, 0, -0.60),
    new THREE.Vector3(0.30, 0, -0.16),
    new THREE.Vector3(0.04, 0, 0.20),
    new THREE.Vector3(0.28, 0, 0.54),
    new THREE.Vector3(0.60, 0, 0.88)
  ], false, 'catmullrom', 0.36);
  const riverSamples = riverCurve.getPoints(90).map(p => ({ x: p.x, z: p.z }));
  riverSamples.push({ x: 0.66, z: 1.00 });

  const RIVER_LEDGE = { x: 0.66, z: 1.00 };
  const LAKE = { x: 1.05, z: 2.18, rx: 1.34, rz: 0.98 };

  function distToRiver(x, z) {
    let best = 999;
    for (let i = 0; i < riverSamples.length - 1; i++) {
      const a = riverSamples[i], b = riverSamples[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const apx = x - a.x, apz = z - a.z;
      const t = clamp((apx * abx + apz * abz) / (abx * abx + abz * abz), 0, 1);
      const dx = apx - abx * t, dz = apz - abz * t;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function lakeQ(x, z) {
    const dx = (x - LAKE.x) / LAKE.rx;
    const dz = (z - LAKE.z) / LAKE.rz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function islandRadius(theta) {
    return 3.70 + 0.20 * Math.sin(theta * 3.0 + 0.72) + 0.11 * Math.sin(theta * 5.0 - 1.4) + 0.055 * Math.sin(theta * 8.0 + 0.4);
  }

  function mountainContribution(x, z) {
    let sum = 0;
    for (let i = 0; i < PEAKS.length; i++) {
      const p = PEAKS[i];
      const dx = (x - p.x) / p.rx;
      const dz = (z - p.z) / p.rz;
      const q = Math.sqrt(dx * dx + dz * dz);
      const bell = Math.pow(Math.max(0, 1 - q), p.p);
      sum += p.h * bell;
    }
    return sum;
  }

  // Height without snow / colour decisions. The lake is carved gently below
  // the "ground" height; the visible water surface is computed afterwards.
  function terrainHeight(x, z) {
    let h = 1.68;
    h += 0.235 * fbm(x * 0.52 + 4.2, z * 0.52 - 2.3, 4);
    h += 0.075 * fbm(x * 1.55 - 1.1, z * 1.55 + 3.4, 3);

    const mountain = mountainContribution(x, z);
    h += mountain;
    if (mountain > 0.03) {
      h += (fbm(x * 2.45 + 2.8, z * 2.45 - 1.7, 4) - 0.5) * Math.min(mountain, 2.9) * 0.38;
      h += (fbm(x * 5.2 + 0.4, z * 5.2 + 2.0, 2) - 0.5) * Math.min(mountain, 1.2) * 0.13;
      h += (fbm(x * 8.4 - 2.1, z * 8.4 + 3.3, 2) - 0.5) * Math.min(mountain, 1.8) * 0.075;
      const peakMask = smoothstep(2.4, 4.1, h);
      h += peakMask * 0.58 * Math.exp(-((x + 1.38) * (x + 1.38) / 0.16 + (z + 1.50) * (z + 1.50) / 0.20));
      h += peakMask * 0.28 * Math.exp(-((x - 0.62) * (x - 0.62) / 0.10 + (z + 2.10) * (z + 2.10) / 0.14));
    }

    // A soft alpine terrace, dropping toward the front of the cube.
    const edgeWobble = 0.13 * Math.sin(x * 1.12 + 0.8) + 0.06 * Math.sin(x * 2.3 - 2.0);
    const terrace = smoothstep(0.78, 1.20, z + edgeWobble);
    h -= 0.96 * terrace;

    // River channel.
    const dr = distToRiver(x, z);
    h -= 0.17 * Math.exp(-Math.pow(dr / 0.34, 2));

    // Lake basin.
    const lq = lakeQ(x, z);
    h -= 0.40 * smoothstep(1.22, 0.10, lq);

    // Gentle island edge roll-off before the rock base begins.
    const theta = Math.atan2(z, x);
    const rr = Math.hypot(x, z) / islandRadius(theta);
    h -= 0.26 * smoothstep(0.82, 1.0, rr);

    return h;
  }

  function heightAt(x, z) { return terrainHeight(x, z); }

  const lakeCenterHeight = heightAt(LAKE.x, LAKE.z);
  const LAKE_LEVEL = lakeCenterHeight + 0.185;

  // Slope magnitude (rise / run) used for rock & snow masks.
  function slopeAt(x, z) {
    const e = 0.055;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(dx * dx + dz * dz);
  }

  function normalAt(x, z) {
    const e = 0.055;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return new THREE.Vector3(-dx, 1, -dz).normalize();
  }

  const C = {
    mossDark: new THREE.Color('#2c4b35'),
    moss: new THREE.Color('#4d6d39'),
    meadow: new THREE.Color('#7c9851'),
    meadowWarm: new THREE.Color('#a5a264'),
    forestFloor: new THREE.Color('#3e5635'),
    rockDark: new THREE.Color('#3d3c39'),
    rock: new THREE.Color('#67645b'),
    rockWarm: new THREE.Color('#83755f'),
    sand: new THREE.Color('#93825e'),
    wetSand: new THREE.Color('#5b5b4d'),
    snowShadow: new THREE.Color('#cfe0ea'),
    snow: new THREE.Color('#fbfdfb'),
    snowLight: new THREE.Color('#ffffff'),
    bed: new THREE.Color('#334f4e')
  };
  const _colA = new THREE.Color(), _colB = new THREE.Color(), _colC = new THREE.Color();

  function terrainColor(x, z, h, slope, out) {
    const n1 = fbm(x * 2.9 + 1.6, z * 2.9 - 0.4, 3);
    const n2 = fbm(x * 7.2 - 2.0, z * 7.2 + 4.0, 2);
    const n3 = fbm(x * 0.82 - 4.0, z * 0.82 + 1.2, 3);

    // Lush meadow base
    out.copy(C.mossDark).lerp(C.moss, clamp(n1 * 0.7 + 0.15, 0, 1));
    out.lerp(C.meadow, smoothstep(0.15, 0.82, n2) * 0.6);
    out.lerp(C.forestFloor, smoothstep(0.58, 0.88, n3) * 0.34);
    out.lerp(C.meadowWarm, smoothstep(0.62, 0.95, fbm(x * 1.4, z * 1.4, 2)) * 0.16);

    // Higher meadows turn a little more olive and cool.
    out.lerp(C.mossDark, smoothstep(2.0, 3.1, h) * 0.22);

    // Shoreline strata around the lake and along the stream.
    const lq = lakeQ(x, z);
    if (lq < 1.45) {
      const shore = 1.0 - smoothstep(0.93, 1.38, lq);
      _colB.copy(C.sand).lerp(C.wetSand, smoothstep(LAKE_LEVEL + 0.05, LAKE_LEVEL - 0.18, h));
      out.lerp(_colB, shore * 0.68);
    }
    const dr = distToRiver(x, z);
    if (dr < 0.7) {
      const bank = 1.0 - smoothstep(0.16, 0.58, dr);
      _colB.copy(C.sand).lerp(C.wetSand, smoothstep(0.35, 0.10, dr));
      out.lerp(_colB, bank * 0.62);
    }

    // Water bed.
    if (lq < 1.08 && h < LAKE_LEVEL + 0.03) {
      out.lerp(C.bed, 0.62);
    }

    // Steep slopes become layered, clay-like stone.
    const rockMix = smoothstep(0.62, 1.55, slope) * 0.88;
    if (rockMix > 0.001) {
      _colB.copy(C.rock).lerp(C.rockDark, smoothstep(0.35, 0.8, n1));
      _colB.lerp(C.rockWarm, smoothstep(0.55, 0.92, n2) * 0.52);
      out.lerp(_colB, rockMix);
    }

    // Snow gathers gently on flatter high ground.
    const snowLine = 1.92 + n3 * 0.3 - smoothstep(0.0, -3.0, z) * 0.12;
    let snowMask = smoothstep(snowLine - 0.25, snowLine + 0.55, h);
    snowMask *= 1.0 - smoothstep(2.3, 3.5, slope) * 0.32;
    snowMask *= smoothstep(0.16, 0.48, fbm(x * 2.2 - 3.0, z * 2.2 + 5.0, 2) + 0.3);
    snowMask *= 0.74 + 0.4 * smoothstep(0.16, 0.82, fbm(x * 5.8 + 1.2, z * 5.8 - 4.0, 3));
    const snowVein = fbm(x * 10.5 - 2.0, z * 10.5 + 4.0, 3);
    snowMask *= 0.8 + 0.26 * smoothstep(0.28, 0.78, snowVein);
    // make sure the mountain reads as snow country, right up to the crags
    snowMask = Math.max(snowMask, smoothstep(2.55, 3.15, h) * 0.9);
    if (snowMask > 0.001) {
      _colB.copy(C.snowShadow).lerp(C.snow, 0.64 + 0.32 * smoothstep(0.2, 0.9, snowVein));
      _colB.lerp(C.snowLight, Math.pow(snowMask, 1.5) * 0.7);
      out.lerp(_colB, snowMask * 0.995);
    }
    // thin dark gullies / exposed strata on high faces
    if (h > 2.5) {
      const gully = smoothstep(0.62, 0.88, fbm(x * 7.3 + 3.5, z * 7.3 - 0.7, 3));
      const crag = smoothstep(1.5, 2.5, slope);
      _colB.copy(C.rockDark).lerp(C.rock, 0.5);
      out.lerp(_colB, (gully * 0.045 + crag * 0.07) * (1.0 - snowMask * 0.92));
    }

    // Subtle clay-like tonal breakup.
    out.multiplyScalar(0.91 + n2 * 0.14);
    return out;
  }

  /* -------------------------------------------------------------------------
     Small canvas textures
     ------------------------------------------------------------------------- */
  function glowTexture(size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const s of stops) grd.addColorStop(s[0], s[1]);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  const glowTex = glowTexture(128, [
    [0, 'rgba(255,255,255,1)'],
    [0.16, 'rgba(255,255,255,.9)'],
    [0.42, 'rgba(255,255,255,.26)'],
    [1, 'rgba(255,255,255,0)']
  ]);
  const bokehTex = glowTexture(256, [
    [0, 'rgba(255,255,255,0)'],
    [0.35, 'rgba(255,255,255,.03)'],
    [0.72, 'rgba(255,255,255,.14)'],
    [0.86, 'rgba(255,255,255,.2)'],
    [1, 'rgba(255,255,255,0)']
  ]);
  const softTex = glowTexture(128, [
    [0, 'rgba(255,255,255,.55)'],
    [0.4, 'rgba(255,255,255,.2)'],
    [1, 'rgba(255,255,255,0)']
  ]);

  const starTex = (function makeStar() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    const glow = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.06, 'rgba(255,255,255,.95)');
    glow.addColorStop(0.2, 'rgba(255,255,255,.26)');
    glow.addColorStop(0.55, 'rgba(255,255,255,.06)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      g.save();
      g.translate(128, 128);
      g.rotate(a);
      const line = g.createLinearGradient(0, 0, 118, 0);
      line.addColorStop(0, 'rgba(255,255,255,.65)');
      line.addColorStop(0.35, 'rgba(255,255,255,.12)');
      line.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = line;
      g.beginPath();
      g.moveTo(0, -2.2);
      g.lineTo(118, 0);
      g.lineTo(0, 2.2);
      g.closePath();
      g.fill();
      g.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  })();

  const petalTex = (function makePetal() {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    g.save();
    g.translate(64, 64);
    g.rotate(-0.35);
    const grad = g.createLinearGradient(-32, 32, 32, -48);
    grad.addColorStop(0, 'rgba(255,255,255,.28)');
    grad.addColorStop(0.5, 'rgba(255,255,255,.9)');
    grad.addColorStop(1, 'rgba(255,255,255,.2)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 48);
    g.bezierCurveTo(-42, 34, -46, -16, -2, -49);
    g.bezierCurveTo(4, -28, 10, -8, 14, 16);
    g.bezierCurveTo(16, 31, 10, 43, 0, 48);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.24)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, 44);
    g.quadraticCurveTo(3, 6, -2, -44);
    g.stroke();
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  })();

  // Fine, almost subliminal clay grain used as bump on the natural materials.
  const clayBumpTex = (function makeClayBump() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        let n = 0.55 * vnoise(x * 0.075, y * 0.075);
        n += 0.27 * vnoise(x * 0.18 + 13.2, y * 0.18 - 8.4);
        n += 0.11 * vnoise(x * 0.46 - 3.1, y * 0.46 + 7.7);
        n += 0.07 * (0.5 + 0.5 * Math.sin(u * 47.0 + Math.cos(v * 31.0) * 2.2));
        const value = clamp(Math.floor(78 + n * 144), 0, 255);
        const i = (y * size + x) * 4;
        img.data[i] = value;
        img.data[i + 1] = value;
        img.data[i + 2] = value;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.1, 2.1);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return tex;
  })();

  /* -------------------------------------------------------------------------
     Backdrop — deep, dark, deliberately out of focus.
     ------------------------------------------------------------------------- */
  function buildBackdrop() {
    const w = 2000, h = 1240;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');

    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#04060b');
    bg.addColorStop(0.38, '#070b12');
    bg.addColorStop(0.7, '#080c11');
    bg.addColorStop(1, '#030509');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    g.globalCompositeOperation = 'screen';
    // broad cool nebula
    let grd = g.createRadialGradient(w * 0.62, h * 0.48, 0, w * 0.62, h * 0.48, w * 0.44);
    grd.addColorStop(0, 'rgba(41,75,88,.20)');
    grd.addColorStop(0.42, 'rgba(24,48,61,.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);

    // faint warm upper-left haze
    grd = g.createRadialGradient(w * 0.24, h * 0.18, 0, w * 0.24, h * 0.18, w * 0.36);
    grd.addColorStop(0, 'rgba(133,98,64,.12)');
    grd.addColorStop(0.5, 'rgba(87,65,51,.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);

    // far-off lavender dust
    grd = g.createRadialGradient(w * 0.84, h * 0.16, 0, w * 0.84, h * 0.16, w * 0.26);
    grd.addColorStop(0, 'rgba(81,72,109,.10)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);

    g.globalCompositeOperation = 'lighter';
    // soft distant bokeh discs
    const bokehCount = IS_MOBILE ? 22 : 42;
    for (let i = 0; i < bokehCount; i++) {
      const x = rand() * w;
      const y = h * (0.08 + rand() * 0.8);
      const r = w * (0.006 + Math.pow(rand(), 2.2) * 0.043);
      const warm = rand() > 0.56;
      const a = 0.035 + rand() * 0.09;
      const ring = g.createRadialGradient(x, y, r * 0.1, x, y, r);
      if (warm) {
        ring.addColorStop(0, `rgba(214,169,116,${a * 0.3})`);
        ring.addColorStop(0.7, `rgba(220,178,128,${a * 0.55})`);
        ring.addColorStop(0.91, `rgba(231,198,153,${a})`);
        ring.addColorStop(1, 'rgba(231,198,153,0)');
      } else {
        ring.addColorStop(0, `rgba(122,169,190,${a * 0.2})`);
        ring.addColorStop(0.7, `rgba(133,179,198,${a * 0.45})`);
        ring.addColorStop(0.91, `rgba(161,204,218,${a * 0.8})`);
        ring.addColorStop(1, 'rgba(161,204,218,0)');
      }
      g.fillStyle = ring;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }

    // pinprick stars
    const starCount = IS_MOBILE ? 140 : 260;
    for (let i = 0; i < starCount; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const size = rand() < 0.9 ? randRange(0.5, 1.4) : randRange(1.4, 2.5);
      const a = 0.08 + rand() * 0.5;
      g.fillStyle = `rgba(${215 + rand() * 40},${222 + rand() * 30},${235},${a})`;
      g.beginPath();
      g.arc(x, y, size, 0, TAU);
      g.fill();
      if (size > 1.8 && rand() > 0.5) {
        g.strokeStyle = `rgba(226,237,255,${a * 0.28})`;
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x - size * 4, y); g.lineTo(x + size * 4, y);
        g.moveTo(x, y - size * 4); g.lineTo(x, y + size * 4);
        g.stroke();
      }
    }

    // a whisper of granularity in the dark
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(180,200,220,${rand() * 0.014})`;
      g.fillRect(rand() * w, rand() * h, 1, 1);
    }

    // vignette baked into the plate
    const vg = g.createRadialGradient(w * 0.5, h * 0.47, h * 0.22, w * 0.5, h * 0.47, h * 0.88);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.6, 'rgba(0,0,0,.14)');
    vg.addColorStop(1, 'rgba(0,0,0,.7)');
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  const backdropTex = buildBackdrop();

  const bgScene = new THREE.Scene();
  const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: backdropTex },
      uTexAspect: { value: 2000 / 1240 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uWarmth: { value: 0.5 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uTex;
      uniform float uTexAspect;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uWarmth;
      varying vec2 vUv;

      void main(){
        float screenAspect = uResolution.x / uResolution.y;
        vec2 uv = vUv;
        // cover the viewport without stretching
        if (screenAspect > uTexAspect) {
          uv = (uv - 0.5) * vec2(1.0, uTexAspect / screenAspect) + 0.5;
        } else {
          uv = (uv - 0.5) * vec2(screenAspect / uTexAspect, 1.0) + 0.5;
        }
        uv += vec2(
          sin(uTime * 0.025) * 0.0035 + (vUv.x - 0.5) * 0.002,
          cos(uTime * 0.021) * 0.0028
        );
        vec3 col = texture2D(uTex, uv).rgb;
        // a slow, almost imperceptible warm/cool breath
        col *= mix(vec3(0.96, 0.98, 1.03), vec3(1.04, 1.0, 0.94), uWarmth);
        col += vec3(0.012, 0.014, 0.018) * smoothstep(0.7, 0.0, length(vUv - 0.5));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bgScene.add(bgMesh);

  /* -------------------------------------------------------------------------
     Environment map — gentle physical light for clay materials
     ------------------------------------------------------------------------- */
  (function buildEnv() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#18202c');
    sky.addColorStop(0.38, '#4a4d50');
    sky.addColorStop(0.5, '#ae8e64');
    sky.addColorStop(0.56, '#5c5b4b');
    sky.addColorStop(1, '#10140f');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1024, 512);
    let sun = g.createRadialGradient(695, 225, 0, 695, 225, 245);
    sun.addColorStop(0, 'rgba(255,239,199,.8)');
    sun.addColorStop(0.32, 'rgba(248,205,149,.24)');
    sun.addColorStop(1, 'rgba(255,210,160,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, 1024, 512);
    sun = g.createRadialGradient(230, 330, 0, 230, 330, 300);
    sun.addColorStop(0, 'rgba(72,118,123,.2)');
    sun.addColorStop(1, 'rgba(72,118,123,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, 1024, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex);
    scene.environment = env.texture;
    tex.dispose();
    pmrem.dispose();
  })();

  /* -------------------------------------------------------------------------
     Lighting
     ------------------------------------------------------------------------- */
  const hemi = new THREE.HemisphereLight(0xc4d9dd, 0x2d2c24, 0.8);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xb9d0dc, 0.12);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffd3a1, 3.0);
  keyLight.position.set(-9, 9, 8);
  keyLight.target.position.set(0, 1.4, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(IS_MOBILE ? 1024 : 1536, IS_MOBILE ? 1024 : 1536);
  keyLight.shadow.camera.left = -7.5;
  keyLight.shadow.camera.right = 7.5;
  keyLight.shadow.camera.top = 8.5;
  keyLight.shadow.camera.bottom = -7.0;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 42;
  keyLight.shadow.bias = -0.00045;
  keyLight.shadow.normalBias = 0.022;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const rimLight = new THREE.DirectionalLight(0x9dc5ff, 0.9);
  rimLight.position.set(9, 7, -7);
  scene.add(rimLight);

  const warmRim = new THREE.DirectionalLight(0xffb76f, 0.7);
  warmRim.position.set(-5.5, 6.5, -9);
  warmRim.target.position.set(0, 2.2, 0);
  scene.add(warmRim);
  scene.add(warmRim.target);

  const fillLight = new THREE.DirectionalLight(0xffd9b0, 0.45);
  fillLight.position.set(4, 3, 11);
  scene.add(fillLight);

  const underGlow = new THREE.PointLight(0x8ed0c8, 0.7, 8, 2);
  underGlow.position.set(0, 0.1, 0);
  scene.add(underGlow);

  const lightState = {
    day: 0.5,
    golden: 1.0,
    night: 0.0,
    warmth: 0.8
  };

  const sunPosGolden = new THREE.Vector3(-10.8, 8.4, 4.2);
  const sunPosDay = new THREE.Vector3(-8.0, 15.2, 5.0);
  const sunPosNight = new THREE.Vector3(8.5, 9.0, -4.5);
  const keyColorGolden = new THREE.Color('#ffb069');
  const keyColorDay = new THREE.Color('#fff2da');
  const keyColorNight = new THREE.Color('#8caeff');
  const hemiSkyDay = new THREE.Color('#b8d7e2');
  const hemiSkyGolden = new THREE.Color('#e2b88e');
  const hemiSkyNight = new THREE.Color('#4b6294');
  const hemiGroundDay = new THREE.Color('#3e4b31');
  const hemiGroundGolden = new THREE.Color('#433229');
  const hemiGroundNight = new THREE.Color('#101622');

  const _keyPos = new THREE.Vector3();
  const _keyCol = new THREE.Color();
  const _hemiSky = new THREE.Color();
  const _hemiGround = new THREE.Color();

  function updateEnvironmentLighting(phase) {
    const elevation = Math.sin((phase - 0.25) * TAU);
    const day = smoothstep(-0.08, 0.7, elevation);
    const golden = smoothstep(-0.16, 0.055, elevation) * (1.0 - smoothstep(0.21, 0.72, elevation));
    const night = 1.0 - smoothstep(-0.34, 0.015, elevation);
    const sum = Math.max(0.0001, day + golden + night);
    const wd = day / sum, wg = golden / sum, wn = night / sum;

    lightState.day = day;
    lightState.golden = golden;
    lightState.night = night;
    lightState.warmth = clamp(golden * 0.85 + wd * 0.34, 0, 1);

    _keyPos.set(
      sunPosGolden.x * wg + sunPosDay.x * wd + sunPosNight.x * wn,
      sunPosGolden.y * wg + sunPosDay.y * wd + sunPosNight.y * wn,
      sunPosGolden.z * wg + sunPosDay.z * wd + sunPosNight.z * wn
    );
    keyLight.position.copy(_keyPos).multiplyScalar(1.05);
    keyLight.target.position.y = 1.6;

    _keyCol.setRGB(0, 0, 0);
    _keyCol.r = keyColorGolden.r * wg + keyColorDay.r * wd + keyColorNight.r * wn;
    _keyCol.g = keyColorGolden.g * wg + keyColorDay.g * wd + keyColorNight.g * wn;
    _keyCol.b = keyColorGolden.b * wg + keyColorDay.b * wd + keyColorNight.b * wn;
    keyLight.color.copy(_keyCol);
    keyLight.intensity = 3.55 * day + 3.85 * golden + 1.0 * night;

    _hemiSky.setRGB(0, 0, 0);
    _hemiSky.r = hemiSkyGolden.r * wg + hemiSkyDay.r * wd + hemiSkyNight.r * wn;
    _hemiSky.g = hemiSkyGolden.g * wg + hemiSkyDay.g * wd + hemiSkyNight.g * wn;
    _hemiSky.b = hemiSkyGolden.b * wg + hemiSkyDay.b * wd + hemiSkyNight.b * wn;
    _hemiGround.setRGB(0, 0, 0);
    _hemiGround.r = hemiGroundGolden.r * wg + hemiGroundDay.r * wd + hemiGroundNight.r * wn;
    _hemiGround.g = hemiGroundGolden.g * wg + hemiGroundDay.g * wd + hemiGroundNight.g * wn;
    _hemiGround.b = hemiGroundGolden.b * wg + hemiGroundDay.b * wd + hemiGroundNight.b * wn;
    hemi.color.copy(_hemiSky);
    hemi.groundColor.copy(_hemiGround);
    hemi.intensity = 0.4 * day + 0.34 * golden + 0.2 * night;

    rimLight.color.setRGB(
      lerp(0.22, 0.62, day) + night * 0.03,
      lerp(0.34, 0.76, day) + night * 0.05,
      lerp(0.62, 1.0, day) + night * 0.09
    );
    rimLight.intensity = 0.55 + day * 0.45 + night * 0.35;
    rimLight.position.set(9, 8, -6);

    fillLight.intensity = 0.28 + day * 0.3 + golden * 0.22;
    fillLight.color.copy(_keyCol).lerp(new THREE.Color('#ffd8b1'), 0.48);
    warmRim.color.setRGB(
      0.72 + golden * 0.28,
      0.46 + golden * 0.2 + night * 0.12,
      0.28 + day * 0.25 + night * 0.4
    );
    warmRim.intensity = 0.22 + golden * 1.15 + day * 0.28 - lightState.night * 0.05;

    underGlow.intensity = 0.3 + night * 0.5 + golden * 0.32;
    underGlow.color.setRGB(0.35 + night * 0.1, 0.65 + night * 0.2, 0.67 + night * 0.22);

    if (scene.fog) {
      scene.fog.color.setRGB(
        lerp(0.024, 0.045, day) + night * 0.002,
        lerp(0.045, 0.06, day) + night * 0.004,
        lerp(0.06, 0.065, day) + night * 0.012
      );
    }
    bgMat.uniforms.uWarmth.value = lightState.warmth;
  }

  /* -------------------------------------------------------------------------
     Terrain
     ------------------------------------------------------------------------- */
  const terrainGroup = new THREE.Group();
  scene.add(terrainGroup);

  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    dithering: true
  });

  function buildTerrainGeometry() {
    const segments = IS_MOBILE ? 200 : 316;
    const rings = IS_MOBILE ? 76 : 116;
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];

    // centre vertex
    const h0 = heightAt(0, 0);
    positions.push(0, h0, 0);
    uvs.push(0.5, 0.5);
    terrainColor(0, 0, h0, slopeAt(0, 0), _colA);
    colors.push(_colA.r, _colA.g, _colA.b);

    const ringStart = [];
    for (let i = 1; i <= rings; i++) {
      const t = Math.pow(i / rings, 0.94);
      ringStart[i] = 1 + (i - 1) * segments;
      for (let j = 0; j < segments; j++) {
        const theta = (j / segments) * TAU;
        const r = t * islandRadius(theta);
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const h = heightAt(x, z);
        const sl = slopeAt(x, z);
        positions.push(x, h, z);
        uvs.push(x * 0.16 + 0.5, z * 0.16 + 0.5);
        terrainColor(x, z, h, sl, _colA);
        colors.push(_colA.r, _colA.g, _colA.b);
      }
    }

    // centre fan
    for (let j = 0; j < segments; j++) {
      const a = 1 + j;
      const b = 1 + ((j + 1) % segments);
      indices.push(0, b, a);
    }
    // rings
    for (let i = 1; i < rings; i++) {
      const a0 = ringStart[i], b0 = ringStart[i + 1];
      for (let j = 0; j < segments; j++) {
        const j2 = (j + 1) % segments;
        const a = a0 + j, b = a0 + j2;
        const c = b0 + j, d = b0 + j2;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const terrainGeo = buildTerrainGeometry();
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.castShadow = true;
  terrainMesh.receiveShadow = true;
  terrainGroup.add(terrainMesh);

  const snowSparkles = (function addSnowSparkles() {
    const count = IS_MOBILE ? 90 : 220;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      let x, z, h, tries = 0;
      do {
        const a = rand() * TAU;
        const r = Math.sqrt(rand()) * 3.4;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        h = heightAt(x, z);
        tries++;
      } while ((h < 3.0 || slopeAt(x, z) > 1.6) && tries < 50);
      pos[i * 3] = x;
      pos[i * 3 + 1] = h + 0.02;
      pos[i * 3 + 2] = z;
      seeds.push(rand() * TAU);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTex,
      color: 0xe6f2ff,
      size: 0.038,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 12;
    terrainGroup.add(points);
    return points;
  })();

  /* -------------------------------------------------------------------------
     Floating rock base
     ------------------------------------------------------------------------- */
  function buildIslandBase() {
    const segments = IS_MOBILE ? 120 : 168;
    const levels = 18;
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];
    const profile = [
      [1.000, -0.02], [1.035, -0.12], [1.022, -0.30], [0.972, -0.56],
      [0.888, -0.84], [0.792, -1.12], [0.675, -1.40], [0.535, -1.65],
      [0.382, -1.86], [0.225, -2.00], [0.085, -2.09], [0.0, -2.13]
    ];
    const levelData = [];
    for (let l = 0; l < profile.length; l++) {
      const p = profile[l];
      levelData.push({ baseR: p[0], baseY: p[1] });
    }

    for (let l = 0; l < levelData.length; l++) {
      const L = levelData[l];
      for (let j = 0; j < segments; j++) {
        const theta = (j / segments) * TAU;
        const edge = islandRadius(theta);
        const wobble = 1.0 + 0.055 * Math.sin(theta * 7.0 + l * 0.55) + 0.024 * Math.sin(theta * 13.0 - l * 0.8);
        const rr = edge * L.baseR * wobble;
        const x = Math.cos(theta) * rr;
        const z = Math.sin(theta) * rr;
        const topH = heightAt(Math.cos(theta) * edge * 0.996, Math.sin(theta) * edge * 0.996);
        let y = topH + L.baseY - 0.03;
        y += 0.055 * Math.sin(theta * 9.0 + l * 1.7) * (l / levelData.length);
        positions.push(x, y, z);
        uvs.push(theta / TAU * 2.4, l / levelData.length * 2.4);

        // Rock colours: mossy lip, warm clay strata, dark basalt depths.
        const depth = -L.baseY;
        const n = fbm(x * 2.0 + 7.0, z * 2.0 - 3.0 + l * 0.17, 3);
        _colA.copy(C.rockWarm).lerp(C.rockDark, smoothstep(0.6, 2.05, depth));
        _colA.lerp(C.rock, smoothstep(0.15, 0.85, n) * 0.5);
        if (l < 3) _colA.lerp(C.moss, 0.55 - l * 0.16);
        if (l > 8 && Math.sin(theta * 6.0 + l) > 0.82) _colA.lerp(C.mossDark, 0.18);
        _colA.multiplyScalar(0.82 + n * 0.28);
        colors.push(_colA.r, _colA.g, _colA.b);
      }
    }

    for (let l = 0; l < levelData.length - 2; l++) {
      const a0 = l * segments;
      const b0 = (l + 1) * segments;
      for (let j = 0; j < segments; j++) {
        const j2 = (j + 1) % segments;
        indices.push(a0 + j, a0 + j2, b0 + j);
        indices.push(a0 + j2, b0 + j2, b0 + j);
      }
    }
    // close bottom with a fan to centre point
    const lastRing = (levelData.length - 1) * segments;
    const bottomCenter = positions.length / 3;
    positions.push(0, heightAt(0, 0) - 2.12, 0);
    uvs.push(0, 0);
    _colA.copy(C.rockDark).multiplyScalar(0.8);
    colors.push(_colA.r, _colA.g, _colA.b);
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % segments;
      indices.push(lastRing + j, lastRing + j2, bottomCenter);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const baseMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
    envMapIntensity: 0.2,
    bumpMap: clayBumpTex,
    bumpScale: 0.11,
    dithering: true
  });
  const baseMesh = new THREE.Mesh(buildIslandBase(), baseMat);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  terrainGroup.add(baseMesh);

  // A few fine root-like stalactites under the floating island.
  (function addRoots() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x41392b, roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const theta = rand() * TAU;
      const edge = islandRadius(theta) * randRange(0.36, 0.78);
      const x = Math.cos(theta) * edge;
      const z = Math.sin(theta) * edge;
      const topH = heightAt(Math.cos(theta) * islandRadius(theta) * 0.95, Math.sin(theta) * islandRadius(theta) * 0.95);
      const y = topH - 0.9 - randRange(0, 0.7);
      const len = randRange(0.15, 0.55);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(randRange(0.025, 0.06), len, 4), mat);
      cone.position.set(x, y - len * 0.5, z);
      cone.rotation.z = randRange(-0.3, 0.3);
      cone.rotation.x = randRange(-0.3, 0.3);
      terrainGroup.add(cone);
    }
  })();

  // A soft reflection/glow plate on the floor of the cube.
  (function addUnderGlowPlate() {
    const mat = new THREE.MeshBasicMaterial({
      map: softTex,
      color: 0x568e87,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const geo = new THREE.PlaneGeometry(8.2, 8.2);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = CUBE.bottom + 0.09;
    m.renderOrder = 2;
    scene.add(m);
  })();

  /* -------------------------------------------------------------------------
     Water
     ------------------------------------------------------------------------- */
  const waterUniforms = {
    uTime: { value: 0 },
    uDay: { value: 1 },
    uGolden: { value: 0 },
    uNight: { value: 0 }
  };

  // ---- river ----
  const riverCurveSmooth = [];
  {
    const pts = riverCurve.getPoints(70);
    // extend with the last little ledge segment
    pts.push(new THREE.Vector3(0.64, 0, 0.94));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const h = heightAt(p.x, p.z);
      riverCurveSmooth.push(new THREE.Vector3(p.x, h + 0.045, p.z));
    }
    // soften vertical judder
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < riverCurveSmooth.length - 1; i++) {
        riverCurveSmooth[i].y = (riverCurveSmooth[i - 1].y + riverCurveSmooth[i].y * 2 + riverCurveSmooth[i + 1].y) * 0.25;
      }
    }
  }

  function makeRiverGeometry() {
    const pts = riverCurveSmooth;
    const positions = [], uvs = [], indices = [];
    const widthBase = 0.14;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const pPrev = pts[Math.max(0, i - 1)];
      const pNext = pts[Math.min(pts.length - 1, i + 1)];
      let tx = pNext.x - pPrev.x, tz = pNext.z - pPrev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len; tz /= len;
      const nx = -tz, nz = tx;
      const t = i / (pts.length - 1);
      const half = widthBase + 0.14 * Math.pow(t, 1.15) + 0.045 * Math.sin(t * 9.0);
      const yLift = 0.012 + 0.008 * Math.sin(t * 13.0);
      positions.push(p.x + nx * half, p.y + yLift, p.z + nz * half);
      positions.push(p.x - nx * half, p.y + yLift, p.z - nz * half);
      uvs.push(0, t, 1, t);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const waterVertexShader = `
    varying vec2 vUv;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const riverMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: waterUniforms.uTime,
      uDay: waterUniforms.uDay,
      uGolden: waterUniforms.uGolden,
      uNight: waterUniforms.uNight,
      uLightDir: { value: new THREE.Vector3(-0.5, 0.8, 0.3) }
    },
    vertexShader: waterVertexShader,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uDay;
      uniform float uGolden;
      uniform float uNight;
      uniform vec3 uLightDir;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      void main(){
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float flow = vUv.y;

        // The stream moves downstream with fast threads of foam and slower
        // swirling eddies. Two scales keep it alive even in close-up.
        float fast = sin(flow * 27.0 - uTime * 11.0 + sin(vUv.x * 13.0 + flow * 9.0) * 2.1);
        float medium = sin(flow * 52.0 - uTime * 17.0 - vUv.x * 8.0 + sin(flow * 8.0 + uTime * 0.7) * 1.4);
        float eddy = sin(flow * 13.0 - uTime * 4.2 + vUv.x * 10.0 + fast * 0.9);
        float glare = pow(max(0.0, sin(flow * 7.0 - uTime * 2.3 + vUv.x * 4.5)), 5.0);

        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(viewDir, normalize(vNormalW)), 0.0, 1.0), 2.0);
        vec3 deep = vec3(0.027, 0.15, 0.18);
        vec3 shallow = vec3(0.16, 0.47, 0.49);
        vec3 warm = vec3(0.72, 0.60, 0.39);
        vec3 col = mix(deep, shallow, 0.27 + 0.19 * medium + 0.12 * fast);
        col += warm * (0.05 + uGolden * 0.12) * smoothstep(0.15, 0.9, eddy * 0.5 + 0.5);
        col += vec3(0.56, 0.76, 0.76) * fres * (0.38 + uDay * 0.18);
        col += vec3(0.75, 0.86, 0.82) * glare * (0.05 + uGolden * 0.06);

        float foam = smoothstep(0.36, 0.92, sin(flow * 18.0 - uTime * 7.2 + sin(vUv.x * 10.0 + flow * 6.0) * 2.0));
        foam *= 0.1;
        foam += smoothstep(0.6, 0.97, sin(flow * 48.0 - uTime * 18.0 + vUv.x * 18.0)) * 0.075;
        foam += smoothstep(0.72, 0.99, sin(flow * 110.0 - uTime * 38.0 + vUv.x * 27.0)) * 0.035;
        foam += pow(1.0 - edge, 2.6) * 0.2;
        col = mix(col, vec3(0.85, 0.94, 0.92), clamp(foam, 0.0, 0.8));
        col *= 0.7 + uDay * 0.36;
        col += uNight * vec3(0.0, 0.032, 0.06);
        float alpha = (0.57 + fres * 0.16 + foam * 0.75) * edge;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const riverMesh = new THREE.Mesh(makeRiverGeometry(), riverMat);
  riverMesh.renderOrder = 4;
  terrainGroup.add(riverMesh);

  // glossy white highlights where the stream trips over small stones
  (function addRapids() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdceceb, transparent: true, opacity: 0.34,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < 7; i++) {
      const t = 0.35 + i * 0.065 + rand() * 0.02;
      const p = riverCurve.getPoint(t);
      const geo = new THREE.PlaneGeometry(randRange(0.08, 0.18), randRange(0.1, 0.32));
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = randRange(-0.6, 0.6);
      m.position.set(p.x + randRange(-0.04, 0.04), heightAt(p.x, p.z) + 0.062, p.z + randRange(-0.06, 0.06));
      m.renderOrder = 5;
      terrainGroup.add(m);
    }
  })();

  // Downstream flecks of foam: clearly readable motion in close-up.
  const riverFlow = (function addRiverFlow() {
    const count = IS_MOBILE ? 38 : 72;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      seeds.push({
        t: rand(),
        speed: randRange(0.045, 0.11),
        lateral: randRange(-0.14, 0.14),
        size: randRange(0.7, 1.25),
        phase: rand() * TAU
      });
      pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTex,
      color: 0xdaf3ef,
      size: 0.08,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 11;
    terrainGroup.add(pts);
    pts.userData = { seeds, base: pos };
    return pts;
  })();

  // ---- lake ----
  function makeLakeGeometry() {
    const segments = 96;
    const positions = [0, 0, 0];
    const uvs = [0.5, 0.5];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU;
      const wobble = 1.0 + 0.035 * Math.sin(a * 3 + 1.0) + 0.02 * Math.sin(a * 7 - 0.3);
      positions.push(Math.cos(a) * LAKE.rx * wobble, 0, Math.sin(a) * LAKE.rz * wobble);
      uvs.push(Math.cos(a) * wobble * 0.5 + 0.5, Math.sin(a) * wobble * 0.5 + 0.5);
    }
    for (let i = 1; i <= segments; i++) {
      indices.push(0, i, i + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const lakeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: waterUniforms.uTime,
      uDay: waterUniforms.uDay,
      uGolden: waterUniforms.uGolden,
      uNight: waterUniforms.uNight,
      uLakeLevel: { value: LAKE_LEVEL }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uDay;
      uniform float uGolden;
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vWorld;

      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p * vec2(1.0, 1.24));
        float edge = smoothstep(0.5, 0.41, r);
        float ripple = sin(r * 74.0 - uTime * 2.7 + sin(atan(p.y, p.x) * 5.0) * 1.3) * 0.5 + 0.5;
        float ripple2 = sin(p.x * 35.0 + p.y * 12.0 + uTime * 1.1) * 0.5 + 0.5;
        float ring = pow(max(0.0, sin(r * 45.0 - uTime * 4.2)), 9.0);
        vec3 deep = vec3(0.025, 0.13, 0.165);
        vec3 shallow = vec3(0.14, 0.35, 0.37);
        vec3 sky = mix(vec3(0.25, 0.36, 0.4), vec3(0.68, 0.60, 0.44), uGolden * 0.75 + 0.1);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 2.0);
        vec3 col = mix(deep, shallow, smoothstep(0.05, 0.55, r) * 0.38 + ripple2 * 0.14);
        col += sky * fres * (0.33 + 0.22 * uDay);
        col += vec3(0.58, 0.68, 0.57) * smoothstep(0.68, 0.95, ripple) * (0.05 + uGolden * 0.08);
        float glint = pow(max(0.0, sin(p.x * 96.0 + uTime * 3.4) * sin(p.y * 77.0 - uTime * 2.7)), 16.0);
        col += vec3(1.0, 0.9, 0.68) * glint * (0.16 + uGolden * 0.32);
        col += vec3(0.54, 0.72, 0.7) * ring * smoothstep(0.1, 0.5, r) * 0.1;
        float shoreFoam = smoothstep(0.39, 0.49, r) * (0.5 + 0.5 * sin(p.x * 43.0 + p.y * 27.0 + uTime * 0.4));
        col = mix(col, vec3(0.72, 0.84, 0.82), shoreFoam * (0.14 + uGolden * 0.08));
        col *= 0.84 + uDay * 0.25;
        col += uNight * vec3(0.01, 0.09, 0.10);
        float alpha = edge * (0.79 + fres * 0.1);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const lakeMesh = new THREE.Mesh(makeLakeGeometry(), lakeMat);
  lakeMesh.position.set(LAKE.x, LAKE_LEVEL, LAKE.z);
  lakeMesh.rotation.y = 0.12;
  lakeMesh.renderOrder = 3;
  terrainGroup.add(lakeMesh);

  const lakeGlints = [];
  for (let i = 0; i < 2; i++) {
    const glintMat = new THREE.MeshBasicMaterial({
      map: softTex,
      color: 0xffe1ac,
      transparent: true,
      opacity: 0.17 - i * 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(1.9 - i * 0.45, 0.65 - i * 0.12), glintMat);
    glint.rotation.x = -Math.PI / 2;
    glint.rotation.z = 0.35 + i * 0.85;
    glint.position.set(LAKE.x - 0.1 + i * 0.22, LAKE_LEVEL + 0.022 + i * 0.0005, LAKE.z + 0.05);
    glint.renderOrder = 4;
    terrainGroup.add(glint);
    lakeGlints.push(glint);
  }

  // ---- waterfall ----
  function makeWaterfallGeometry() {
    const top = new THREE.Vector3(RIVER_LEDGE.x, heightAt(RIVER_LEDGE.x, RIVER_LEDGE.z) + 0.03, RIVER_LEDGE.z + 0.02);
    const bottomZ = LAKE.z - LAKE.rz * 0.73;
    const positions = [], uvs = [], indices = [];
    const steps = 30;
    const width = 0.29;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const ease = t * t * (3 - 2 * t);
      const y = lerp(top.y, LAKE_LEVEL + 0.02, ease);
      const z = lerp(top.z, bottomZ, ease);
      const x = top.x + Math.sin(t * Math.PI) * 0.035 + t * 0.02;
      const w = width * (0.66 + t * 0.84) * (0.94 + 0.06 * Math.sin(t * 19.0));
      positions.push(x - w, y, z + 0.012);
      positions.push(x + w, y, z + 0.012);
      uvs.push(0, t, 1, t);
    }
    for (let i = 0; i < steps - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const fallMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: waterUniforms.uTime,
      uDay: waterUniforms.uDay,
      uGolden: waterUniforms.uGolden,
      uNight: waterUniforms.uNight
    },
    vertexShader: waterVertexShader,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uDay;
      uniform float uGolden;
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      void main(){
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float streak = sin(vUv.y * 58.0 - uTime * 26.0 + sin(vUv.x * 18.0 + vUv.y * 7.0 + uTime * 0.7) * 2.0) * 0.5 + 0.5;
        float streak2 = sin(vUv.y * 127.0 - uTime * 51.0 + vUv.x * 12.0) * 0.5 + 0.5;
        float streak3 = sin(vUv.y * 214.0 - uTime * 84.0 + vUv.x * 28.0 + sin(vUv.y * 17.0 + uTime) * 0.8) * 0.5 + 0.5;
        float chunks = smoothstep(0.55, 0.92, sin(vUv.y * 21.0 - uTime * 9.2 + vUv.x * 4.0 + sin(vUv.x * 8.0 + uTime * 0.5) * 1.5) * 0.5 + 0.5);
        vec3 col = mix(vec3(0.23, 0.46, 0.49), vec3(0.9, 0.98, 0.95), streak * 0.62 + streak2 * 0.22 + streak3 * 0.1 + chunks * 0.18);
        col += vec3(0.98, 0.94, 0.82) * pow(streak2, 4.0) * (0.4 + uGolden * 0.25);
        col += vec3(0.88, 0.97, 0.96) * pow(streak3, 6.0) * 0.35;
        col *= 0.85 + uDay * 0.2;
        col += uNight * vec3(0.0, 0.03, 0.055);
        float bottomFade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
        float alpha = edge * (0.58 + streak * 0.26 + streak2 * 0.16 + streak3 * 0.08 + chunks * 0.18) * bottomFade;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const waterfallMesh = new THREE.Mesh(makeWaterfallGeometry(), fallMat);
  waterfallMesh.renderOrder = 5;
  terrainGroup.add(waterfallMesh);

  const fallGlowMat = fallMat.clone();
  fallGlowMat.blending = THREE.AdditiveBlending;
  fallGlowMat.uniforms.uTime = waterUniforms.uTime;
  fallGlowMat.uniforms.uDay = waterUniforms.uDay;
  fallGlowMat.uniforms.uGolden = waterUniforms.uGolden;
  fallGlowMat.uniforms.uNight = waterUniforms.uNight;
  const fallGlowMesh = new THREE.Mesh(makeWaterfallGeometry(), fallGlowMat);
  fallGlowMesh.scale.set(1.8, 1.0, 1.02);
  fallGlowMesh.position.z = -0.02;
  fallGlowMesh.renderOrder = 4;
  terrainGroup.add(fallGlowMesh);

  // waterfall mist and foam
  const fallMistSprites = [];
  (function addFallMist() {
    const baseY = LAKE_LEVEL + 0.06;
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTex,
        color: i % 3 === 0 ? 0xeafaf6 : 0xbcdcd6,
        transparent: true,
        opacity: randRange(0.06, 0.16),
        depthWrite: false,
        blending: i % 4 === 0 ? THREE.AdditiveBlending : THREE.NormalBlending
      }));
      const r = randRange(0.25, 0.9);
      s.position.set(
        RIVER_LEDGE.x + randRange(-0.24, 0.3),
        baseY + randRange(-0.02, 0.32),
        LAKE.z - LAKE.rz * 0.7 + randRange(-0.28, 0.28)
      );
      s.scale.set(r * 1.5, r * 0.7, 1);
      s.userData = { seed: rand() * 10, baseX: s.position.x, baseY: s.position.y, baseZ: s.position.z, amp: randRange(0.06, 0.22) };
      s.renderOrder = 7;
      terrainGroup.add(s);
      fallMistSprites.push(s);
    }
    const top = heightAt(RIVER_LEDGE.x, RIVER_LEDGE.z);
    const baseZ = LAKE.z - LAKE.rz * 0.7;
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.SpriteMaterial({
        map: softTex,
        color: 0xd7ebe7,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const s = new THREE.Sprite(mat);
      const t = i / 6;
      s.position.set(RIVER_LEDGE.x + 0.04, lerp(top, LAKE_LEVEL + 0.1, t), lerp(RIVER_LEDGE.z, baseZ, t));
      s.scale.set(0.7 + t * 0.65, 0.5 + t * 0.5, 1);
      s.userData = { baseX: s.position.x, baseY: s.position.y, baseZ: s.position.z, amp: 0.05, seed: rand() * 10 };
      s.renderOrder = 7;
      terrainGroup.add(s);
      fallMistSprites.push(s);
    }
  })();

  const risingFallMist = [];
  (function addRisingFallMist() {
    const baseZ = LAKE.z - LAKE.rz * 0.7;
    const baseY = LAKE_LEVEL + 0.04;
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.SpriteMaterial({
        map: softTex,
        color: 0xd4e9e4,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        blending: i % 3 === 0 ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      const s = new THREE.Sprite(mat);
      s.position.set(RIVER_LEDGE.x + randRange(-.22, .25), baseY, baseZ + randRange(-.2, .2));
      s.scale.set(randRange(.35, .9), randRange(.25, .6), 1);
      s.renderOrder = 7;
      s.userData = {
        phase: rand(), speed: randRange(.12, .26), baseX: s.position.x, baseZ: s.position.z,
        drift: randRange(.04, .18), scale: s.scale.x, rise: randRange(.45, 1.15)
      };
      terrainGroup.add(s);
      risingFallMist.push(s);
    }
  })();

  const fallFoam = [];
  (function addFallFoam() {
    const topY = heightAt(RIVER_LEDGE.x, RIVER_LEDGE.z) + 0.06;
    const topZ = RIVER_LEDGE.z + 0.02;
    const bottomZ = LAKE.z - LAKE.rz * 0.72;
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: softTex,
        color: i % 4 === 0 ? 0xffffff : 0xdaf1ed,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: i % 3 === 0 ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 7;
      s.userData = {
        phase: rand(),
        speed: randRange(0.35, 0.7),
        lateral: randRange(-0.15, 0.15),
        sway: randRange(0.02, 0.09),
        size: randRange(0.18, 0.42),
        topY, topZ, bottomZ
      };
      s.position.set(RIVER_LEDGE.x, topY, topZ);
      s.scale.set(0.1, 0.3, 1);
      terrainGroup.add(s);
      fallFoam.push(s);
    }
  })();

  // Waterfall foam and a veil of airborne droplets.
  const splashPoints = (function addWaterfallSplash() {
    const count = IS_MOBILE ? 48 : 100;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = [];
    const baseZ = LAKE.z - LAKE.rz * 0.70;
    for (let i = 0; i < count; i++) {
      seeds.push({
        angle: rand() * TAU,
        radius: randRange(0.04, 0.42),
        speed: randRange(0.45, 0.9),
        phase: rand(),
        lift: randRange(0.18, 0.52)
      });
      pos[i * 3] = RIVER_LEDGE.x + 0.08;
      pos[i * 3 + 1] = LAKE_LEVEL + 0.08;
      pos[i * 3 + 2] = baseZ;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTex,
      color: 0xd9f1ed,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 11;
    terrainGroup.add(points);
    points.userData = { seeds, baseZ, pos };

    // soft foam bloom on the lake surface
    const foamMat = new THREE.MeshBasicMaterial({
      map: softTex,
      color: 0xcbe8e3,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 - i * 0.25, 0.75 - i * 0.1), foamMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = 0.15 + i * 0.8;
      m.position.set(RIVER_LEDGE.x + 0.06 + i * 0.08, LAKE_LEVEL + 0.018 + i * 0.001, baseZ + 0.06);
      m.renderOrder = 4;
      terrainGroup.add(m);
    }
    return points;
  })();

  /* -------------------------------------------------------------------------
     Glass cube
     ------------------------------------------------------------------------- */
  const glassGroup = new THREE.Group();
  scene.add(glassGroup);

  const glassVert = `
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying vec2 vUv;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const glassMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarmth: { value: 0.5 },
      uNight: { value: 0 }
    },
    vertexShader: glassVert,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uWarmth;
      uniform float uNight;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;

      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, 2.15);

        // one broad reflection, not a repeating pattern: a soft imaginary
        // light panel caught by the pane.
        vec3 R = reflect(-V, N);
        float panel = exp(-pow((R.x * 0.74 + R.y * 0.56 - 0.30) / 0.21, 2.0));
        panel *= smoothstep(0.12, 0.8, ndv);
        float topSheen = smoothstep(0.2, 0.92, abs(N.y)) * smoothstep(4.0, 8.7, vWorld.y);
        float lowHaze = (1.0 - smoothstep(0.0, 2.8, vWorld.y)) * smoothstep(0.55, 0.95, ndv);
        float sweep = exp(-pow((vWorld.y * 0.86 + vWorld.x * 0.34 - 3.55) / 0.72, 2.0));
        sweep *= smoothstep(0.28, 0.84, ndv);

        vec3 cool = vec3(0.38, 0.64, 0.70);
        vec3 warm = vec3(0.97, 0.76, 0.53);
        vec3 col = mix(cool, warm, clamp(uWarmth * 0.62 + N.y * 0.18, 0.0, 1.0));
        col *= fres * 0.78 + panel * 0.34 + topSheen * 0.28 + sweep * 0.16 + lowHaze * 0.01;
        col += vec3(0.15, 0.19, 0.22) * fres * (0.24 + uNight * 0.12);

        // tiny prism fringe at extreme grazing angles
        float prism = pow(fres, 4.0);
        col += vec3(0.35, 0.58, 0.82) * prism * 0.28;
        col += vec3(0.82, 0.52, 0.34) * pow(panel, 3.0) * 0.16;

        float alpha = 0.007 + fres * 0.075 + panel * 0.03 + topSheen * 0.022 + sweep * 0.012;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.NormalBlending
  });

  const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(CUBE.half * 2, CUBE.height, CUBE.half * 2), glassMat);
  glassMesh.position.y = CUBE.centerY;
  glassMesh.renderOrder = 40;
  glassGroup.add(glassMesh);

  const edgeMatCore = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(1.75, 2.04, 2.16),
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const edgeMatGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(0.34, 0.53, 0.62),
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const edgeMatWarm = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(0.72, 0.49, 0.30),
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });

  (function buildGlassEdges() {
    const h = CUBE.half;
    const y0 = CUBE.bottom, y1 = CUBE.top;
    const vertical = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
    const horizontal = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
    const positions = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) positions.push({ a: new THREE.Vector3(sx * h, y0, sz * h), b: new THREE.Vector3(sx * h, y1, sz * h), axis: 'y' });
    }
    for (const sy of [y0, y1]) {
      for (const sz of [-1, 1]) positions.push({ a: new THREE.Vector3(-h, sy, sz * h), b: new THREE.Vector3(h, sy, sz * h), axis: 'x' });
      for (const sx of [-1, 1]) positions.push({ a: new THREE.Vector3(sx * h, sy, -h), b: new THREE.Vector3(sx * h, sy, h), axis: 'z' });
    }

    const up = new THREE.Vector3(0, 1, 0);
    for (const e of positions) {
      const mid = e.a.clone().add(e.b).multiplyScalar(0.5);
      const dir = e.b.clone().sub(e.a);
      const len = dir.length();
      dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);

      const core = new THREE.Mesh(vertical, edgeMatCore);
      core.position.copy(mid);
      core.quaternion.copy(q);
      core.scale.set(0.0075, len, 0.0075);
      core.renderOrder = 42;
      glassGroup.add(core);

      const glow = new THREE.Mesh(vertical, edgeMatGlow);
      glow.position.copy(mid);
      glow.quaternion.copy(q);
      glow.scale.set(0.044, len, 0.044);
      glow.renderOrder = 41;
      glassGroup.add(glow);

      if (e.axis === 'x' || e.axis === 'z') {
        const warm = new THREE.Mesh(horizontal, edgeMatWarm);
        warm.position.copy(mid);
        warm.quaternion.copy(q);
        warm.scale.set(0.075, len * 0.84, 0.075);
        warm.renderOrder = 40;
        glassGroup.add(warm);
      }
    }

    // corner dewdrop glints
    const glintGeo = new THREE.SphereGeometry(0.022, 8, 6);
    const glintMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.2, 2.6, 2.8),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    for (const sx of [-1, 1]) for (const sy of [y0, y1]) for (const sz of [-1, 1]) {
      const dot = new THREE.Mesh(glintGeo, glintMat);
      dot.position.set(sx * h, sy, sz * h);
      glassGroup.add(dot);
    }
  })();

  // A soft interior light-source bloom, visible through the top-left glass.
  const sunGlowMat = new THREE.SpriteMaterial({
    map: softTex,
    color: 0xffe3b5,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.position.set(-2.95, 8.05, 0.2);
  sunGlow.scale.set(4.0, 4.0, 1);
  sunGlow.renderOrder = 20;
  scene.add(sunGlow);
  const sunHaloMat = new THREE.SpriteMaterial({
    map: softTex,
    color: 0xfff1d8,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sunHalo = new THREE.Sprite(sunHaloMat);
  sunHalo.position.copy(sunGlow.position);
  sunHalo.scale.set(1.9, 1.9, 1);
  sunHalo.renderOrder = 20;
  scene.add(sunHalo);
  const sunStreakMat = new THREE.SpriteMaterial({
    map: softTex,
    color: 0xffe4b2,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sunStreak = new THREE.Sprite(sunStreakMat);
  sunStreak.position.copy(sunGlow.position);
  sunStreak.scale.set(3.4, 0.11, 1);
  sunStreak.renderOrder = 20;
  scene.add(sunStreak);
  const sunCoreMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xfff0cf,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sunCore = new THREE.Sprite(sunCoreMat);
  sunCore.position.copy(sunGlow.position);
  sunCore.scale.set(0.42, 0.42, 1);
  sunCore.renderOrder = 21;
  scene.add(sunCore);

  (function addGlassLines() {
    const h = CUBE.half;
    const corners = [];
    for (const x of [-h, h]) for (const y of [CUBE.bottom, CUBE.top]) for (const z of [-h, h]) corners.push([x, y, z]);
    const edges = [
      [0,1],[2,3],[4,5],[6,7],
      [0,2],[1,3],[4,6],[5,7],
      [0,4],[1,5],[2,6],[3,7]
    ];
    const pos = [];
    for (const [a,b] of edges) { pos.push(...corners[a], ...corners[b]); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xdff7ff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 44;
    glassGroup.add(lines);
  })();

  const cornerGlints = [];
  (function addCornerGlints() {
    const h = CUBE.half;
    const specs = [
      { x: h, y: CUBE.top, z: -h, warm: true, s: 0.62, op: 0.42 },
      { x: -h, y: CUBE.top, z: h, warm: false, s: 0.52, op: 0.36 },
      { x: h, y: CUBE.top, z: h, warm: true, s: 0.40, op: 0.30 },
      { x: h, y: CUBE.bottom, z: h, warm: false, s: 0.34, op: 0.24 }
    ];
    for (const spec of specs) {
      const mat = new THREE.SpriteMaterial({
        map: starTex,
        color: spec.warm ? 0xffe6bd : 0xd8ecff,
        transparent: true,
        opacity: spec.op,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(spec.x, spec.y, spec.z);
      sprite.scale.set(spec.s, spec.s, 1);
      sprite.renderOrder = 45;
      sprite.userData = { baseOpacity: spec.op, phase: rand() * TAU };
      scene.add(sprite);
      cornerGlints.push(sprite);
    }
  })();

  /* -------------------------------------------------------------------------
     Placeholder vegetation / rocks / details
     ------------------------------------------------------------------------- */
  const details = new THREE.Group();
  scene.add(details);

  // A starter set of soft clay trees. This is replaced/extended below.
  function makeTreeTemplates() {
    function merge(list) {
      const posArr = [], normArr = [], uvArr = [];
      for (const item of list) {
        const g = item.geo.clone();
        if (item.matrix) g.applyMatrix4(item.matrix);
        if (g.index) {
          const ni = g.toNonIndexed();
          g.dispose();
          posArr.push(...ni.getAttribute('position').array);
          normArr.push(...ni.getAttribute('normal').array);
          const u = ni.getAttribute('uv');
          if (u) uvArr.push(...u.array);
          ni.dispose();
        } else {
          posArr.push(...g.getAttribute('position').array);
          normArr.push(...g.getAttribute('normal').array);
          const u = g.getAttribute('uv');
          if (u) uvArr.push(...u.array);
          g.dispose();
        }
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      out.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
      if (uvArr.length === (posArr.length / 3) * 2) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
      out.computeVertexNormals();
      return out;
    }

    const ico = new THREE.IcosahedronGeometry(1, 2);
    const canopyParts = [];
    const blobs = [
      [0, 1.24, 0, 0.60, 0.55, 0.58],
      [-0.39, 1.06, 0.09, 0.38, 0.41, 0.37],
      [0.36, 1.03, -0.11, 0.42, 0.39, 0.39],
      [0.02, 0.94, 0.33, 0.36, 0.33, 0.33],
      [-0.19, 0.90, -0.31, 0.31, 0.29, 0.29],
      [0.12, 1.45, 0.02, 0.31, 0.27, 0.28]
    ];
    for (const b of blobs) {
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(b[0], b[1], b[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(randRange(-.3, .3), randRange(0, TAU), randRange(-.2, .2))),
        new THREE.Vector3(b[3], b[4], b[5])
      );
      canopyParts.push({ geo: ico, matrix: m });
    }
    function roughenGeometry(geo, centerY, amount, frequency) {
      const p = geo.getAttribute('position');
      const v = new THREE.Vector3();
      const c = new THREE.Vector3(0, centerY, 0);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const dir = v.clone().sub(c);
        if (dir.lengthSq() < 1e-6) continue;
        dir.normalize();
        const n = (fbm(v.x * frequency + 4.1, v.z * frequency - 2.3, 3) - 0.5) * amount;
        v.addScaledVector(dir, n);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    }

    function addShade(geo, yLow, yHigh, low, high) {
      const p = geo.getAttribute('position');
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const t = clamp((y - yLow) / (yHigh - yLow), 0, 1);
        const shade = lerp(low, high, t * t * (3 - 2 * t));
        const jitter = 0.94 + 0.12 * Math.sin(p.getX(i) * 13.1 + p.getZ(i) * 9.7 + y * 18.0);
        col[i * 3] = shade * jitter * 0.93;
        col[i * 3 + 1] = shade * jitter * 1.0;
        col[i * 3 + 2] = shade * jitter * 0.82;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    }

    const broadCanopy = (function shrinkCore(geo) {
      const p = geo.getAttribute('position');
      const center = new THREE.Vector3(0, 1.08, 0);
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        v.sub(center).multiplyScalar(0.86).add(center);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    })(roughenGeometry(addShade(merge(canopyParts), 0.42, 1.72, 0.34, 1.14), 1.08, 0.08, 5.7));

    const coneParts = [];
    const coneSpecs = [
      [0.42, 0.42, 0.86], [0.36, 0.42, 1.13], [0.29, 0.40, 1.40], [0.20, 0.36, 1.66], [0.11, 0.30, 1.89]
    ];
    for (let i = 0; i < coneSpecs.length; i++) {
      const s = coneSpecs[i];
      const m = new THREE.Matrix4().makeTranslation(0, s[2], 0);
      coneParts.push({ geo: new THREE.ConeGeometry(s[0], s[1], 9, 1), matrix: m });
    }
    const coniferCanopy = roughenGeometry(addShade(merge(coneParts), 0.55, 2.04, 0.42, 1.09), 1.2, 0.035, 8.0);

    function makeBranchPart(a, b, r0, r1, radialSegs) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(r1, r0, len, radialSegs || 6, 2);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return { geo, matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) };
    }
    const branchParts = [
      makeBranchPart(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.62, 0), 0.09, 0.042, 7),
      makeBranchPart(new THREE.Vector3(0, 0.32, 0), new THREE.Vector3(0.27, 0.78, 0.12), 0.048, 0.018, 6),
      makeBranchPart(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(-0.2, 0.72, -0.16), 0.043, 0.016, 6),
      makeBranchPart(new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0.07, 1.13, 0.24), 0.038, 0.013, 6),
      makeBranchPart(new THREE.Vector3(-0.2, 0.72, -0.16), new THREE.Vector3(-0.39, 0.98, -0.1), 0.018, 0.007, 5),
      makeBranchPart(new THREE.Vector3(-0.2, 0.72, -0.16), new THREE.Vector3(-0.24, 0.98, -0.34), 0.015, 0.006, 5),
      makeBranchPart(new THREE.Vector3(0.27, 0.78, 0.12), new THREE.Vector3(0.43, 1.02, 0.2), 0.016, 0.006, 5),
      makeBranchPart(new THREE.Vector3(0.27, 0.78, 0.12), new THREE.Vector3(0.24, 1.05, -0.06), 0.014, 0.005, 5),
      makeBranchPart(new THREE.Vector3(0.07, 1.13, 0.24), new THREE.Vector3(0.2, 1.34, 0.32), 0.009, 0.004, 5),
      makeBranchPart(new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.15, 0.23, 0.2), 0.028, 0.012, 5)
    ];
    const broadTrunk = merge(branchParts);
    const coniferTrunkGeo = new THREE.CylinderGeometry(0.035, 0.07, 0.65, 9, 2);
    const coniferTrunk = merge([{ geo: coniferTrunkGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.325, 0) }]);

    // clumps of tiny leaves that break the smooth canopy silhouette
    const tuftParts = [];
    const tuftIco = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 22; i++) {
      const a = rand() * TAU;
      const u = rand() * 2 - 1;
      const rr = Math.pow(rand(), 0.42);
      const hx = Math.cos(a) * Math.sqrt(1 - u * u) * 0.60 * rr;
      const hy = 1.08 + u * 0.46 * rr;
      const hz = Math.sin(a) * Math.sqrt(1 - u * u) * 0.55 * rr;
      const scale = randRange(0.055, 0.125);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(hx, hy, hz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(), rand() * TAU, rand())),
        new THREE.Vector3(scale * randRange(1.0, 1.6), scale * randRange(0.65, 1.0), scale)
      );
      tuftParts.push({ geo: tuftIco, matrix: m });
    }
    const leafTufts = addShade(merge(tuftParts), 0.5, 1.6, 0.6, 1.2);
    tuftIco.dispose();

    // low bush / fern clump
    const bushParts = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(randRange(-.28, .28), 0.12 + rand() * 0.1, randRange(-.28, .28)),
        new THREE.Quaternion(),
        new THREE.Vector3(randRange(.20, .32), randRange(.10, .19), randRange(.20, .32))
      );
      bushParts.push({ geo: ico, matrix: m });
    }
    const bush = merge(bushParts);
    ico.dispose();

    return { broadCanopy, coniferCanopy, broadTrunk, coniferTrunk, bush, leafTufts };
  }
  const treeTpl = makeTreeTemplates();
  const treeCanopyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0, flatShading: false,
    vertexColors: true, envMapIntensity: 0.24,
    bumpMap: clayBumpTex, bumpScale: 0.04, dithering: true
  });
  const treeConiferMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.86, metalness: 0,
    vertexColors: true, envMapIntensity: 0.24,
    bumpMap: clayBumpTex, bumpScale: 0.035, dithering: true
  });
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x5b4531, roughness: 0.96, metalness: 0,
    map: null, bumpMap: clayBumpTex, bumpScale: 0.025, dithering: true
  });
  const bushMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0,
    envMapIntensity: 0.2, bumpMap: clayBumpTex, bumpScale: 0.03, dithering: true
  });
  const tuftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8, metalness: 0,
    vertexColors: true, envMapIntensity: 0.22,
    bumpMap: clayBumpTex, bumpScale: 0.02, dithering: true
  });
  addWind(treeCanopyMat, { strength: 0.006, yBias: 0.42, freq: 0.6, curl: 0.78, space: 0.11, phase: 0.3 });
  addWind(treeConiferMat, { strength: 0.0032, yBias: 0.5, freq: 0.72, curl: 0.82, space: 0.12, phase: 1.1 });
  addWind(tuftMat, { strength: 0.008, yBias: 0.44, freq: 0.66, curl: 0.75, space: 0.13, phase: 0.3 });
  addWind(bushMat, { strength: 0.13, yBias: 0.06, freq: 1.85, curl: 0.82 });

  const treePositions = [];
  // Two exceptionally detailed hero trees generated with Tripo replace the old
  // procedural silhouettes at these matching spots.
  const HERO_TREE_SPOTS = [
    { x: -2.62, z: 2.58, s: 1.46, yaw: 0.35 },
    { x: 3.02, z: 0.66, s: 1.34, yaw: 1.55 },
    { x: 2.86, z: -0.26, s: 1.26, yaw: 4.15 },
    { x: -2.34, z: -2.30, s: 1.14, yaw: 2.55 }
  ];
  const CONIFER_SPOTS = [
    { x: 1.84, z: -2.72, yaw: 0.60, scale: 1.00 },
    { x: 0.98, z: -2.58, yaw: 2.20, scale: 0.86 },
    { x: -0.44, z: -2.82, yaw: 1.30, scale: 0.74 }
  ];
  const ROCK_SPOTS = [
    { x: -0.55, z: 2.95, height: 0.55, yaw: 0.80 },
    { x: 2.35, z: 2.18, height: 0.58, yaw: 2.35 },
    { x: -1.72, z: 1.28, height: 0.42, yaw: 3.80 }
  ];
  // The old green tree at this spot becomes an autumn maple instead.
  const AUTUMN_TREE_SPOT = { x: 2.86, z: -0.26, s: 1.26, yaw: 4.15 };
  // A detailed doe grazes at the open right shore.
  const DEER_SPOT = { x: 1.95, z: 2.95, height: 0.62, yaw: 2.55 };
  // Detailed crags embedded into the snow mountain's shoulders.
  const CRAG_SPOTS = [
    { x: 1.55, z: -0.35, height: 1.18, yaw: 0.75 },
    { x: -1.20, z: -0.05, height: 0.92, yaw: 2.30 }
  ];
  const broadMatrices = [], broadColors = [], tuftMatrices = [], tuftColors = [];
  const coniferMatrices = [], coniferColors = [];
  const bushMatrices = [], bushColors = [];

  const tempM = new THREE.Matrix4();
  const tempQ = new THREE.Quaternion();
  const tempPos = new THREE.Vector3();
  const tempScale = new THREE.Vector3();

  function canPlace(x, z, options) {
    const o = options || {};
    const r = Math.hypot(x, z);
    const theta = Math.atan2(z, x);
    const edge = islandRadius(theta);
    if (r > edge * (o.edge || 0.9)) return false;
    const h = heightAt(x, z);
    if (h < (o.minH ?? 0.35) || h > (o.maxH ?? 4.2)) return false;
    if (lakeQ(x, z) < (o.lake ?? 1.08)) return false;
    if (distToRiver(x, z) < (o.river ?? 0.34)) return false;
    if (slopeAt(x, z) > (o.slope ?? 1.05)) return false;
    if (o.minR && r < o.minR) return false;
    return true;
  }

  function addBroadTree(x, z, s, tint, yaw) {
    const h = heightAt(x, z);
    tempPos.set(x, h - 0.03, z);
    tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    tempScale.set(s * randRange(0.87, 1.13), s * randRange(0.93, 1.16), s * randRange(0.87, 1.13));
    tempM.compose(tempPos, tempQ, tempScale);
    broadMatrices.push(tempM.clone());
    broadColors.push(tint);
    tuftMatrices.push(tempM.clone());
    tuftColors.push(tint.clone().multiplyScalar(1.16));
    treePositions.push({ x, z, type: 'broad', s });
  }
  function addConifer(x, z, s, tint, yaw) {
    const h = heightAt(x, z);
    tempPos.set(x, h - 0.03, z);
    tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    tempScale.set(s * randRange(0.9, 1.1), s * randRange(0.94, 1.12), s * randRange(0.9, 1.1));
    tempM.compose(tempPos, tempQ, tempScale);
    coniferMatrices.push(tempM.clone());
    coniferColors.push(tint);
    treePositions.push({ x, z, type: 'conifer', s });
  }

  (function distributeTrees() {
    const forestCenters = [
      { x: 2.72, z: 1.28, r: 0.86, n: 13, type: 'broad' },
      { x: 2.78, z: -1.04, r: 1.00, n: 10, type: 'broad' },
      { x: 2.20, z: -2.58, r: 0.80, n: 6, type: 'broad' },
      { x: -2.58, z: 0.58, r: 0.94, n: 9, type: 'broad' },
      { x: -2.18, z: 2.32, r: 0.72, n: 5, type: 'broad' },
      { x: -2.05, z: -1.38, r: 0.86, n: 6, type: 'conifer' },
      { x: 2.08, z: -2.52, r: 0.72, n: 5, type: 'conifer' },
      { x: 1.10, z: -1.86, r: 0.68, n: 4, type: 'broad' }
    ];

    for (const c of forestCenters) {
      let accepted = 0;
      for (let i = 0; i < c.n * 5 && accepted < c.n; i++) {
        const a = rand() * TAU;
        const rad = Math.sqrt(rand()) * c.r;
        const x = c.x + Math.cos(a) * rad;
        const z = c.z + Math.sin(a) * rad;
        if (HERO_TREE_SPOTS.some(p => Math.hypot(x - p.x, z - p.z) < p.s * 0.62)) continue;
        if (CONIFER_SPOTS.some(p => Math.hypot(x - p.x, z - p.z) < 0.62)) continue;
        const isConifer = c.type === 'conifer' || (heightAt(x, z) > 2.5 && rand() < 0.35);
        if (lakeQ(x, z) < (isConifer ? 1.7 : 2.02)) continue;
        if (z > 0.55 && x > -1.55 && x < 2.25) continue;
        if (z > 2.05 && x < 2.65) continue;
        if (!canPlace(x, z, {
          edge: 0.89,
          lake: isConifer ? 1.2 : 1.65,
          river: 0.55,
          slope: isConifer ? 1.38 : 1.08,
          minH: 0.55,
          maxH: isConifer ? 2.95 : 2.55
        })) continue;
        if (rand() < 0.12) continue;
        const s = (isConifer ? randRange(0.52, 0.86) : randRange(0.38, 0.78)) * (accepted > c.n * 0.6 ? 0.9 : 1.0);
        const yaw = rand() * TAU;
        if (isConifer) {
          const tint = new THREE.Color().setHSL(0.335 + rand() * 0.025, 0.24 + rand() * 0.09, 0.16 + rand() * 0.065);
          addConifer(x, z, s, tint, yaw);
        } else {
          const variance = rand();
          const tint = variance < 0.035
            ? new THREE.Color().setHSL(0.96, 0.28, 0.55)
            : variance < 0.10
              ? new THREE.Color().setHSL(0.13, 0.3, 0.36)
              : new THREE.Color().setHSL(0.25 + rand() * 0.05, 0.26 + rand() * 0.12, 0.19 + rand() * 0.075);
          addBroadTree(x, z, s, tint, yaw);
        }
        accepted++;
      }
    }

    // Deliberate silhouettes that frame the little valley rather than hide it.
    addConifer(-2.82, -1.72, 0.8, new THREE.Color('#425f49'), 0.5);

    // Let the contact-shadow pass know about the hero trees too.
    for (const spot of HERO_TREE_SPOTS) {
      treePositions.push({ x: spot.x, z: spot.z, type: 'broad', s: spot.s * 0.52 });
    }

    // a few small flowering shrubs add colour without hiding the lake
    const pinkShrubs = [[2.45, 2.7, 0.62], [-1.9, 2.35, 0.52], [0.4, 3.15, 0.48], [2.65, 1.4, 0.4]];
    for (const b of pinkShrubs) {
      const x = b[0] + randRange(-.12, .12);
      const z = b[1] + randRange(-.12, .12);
      if (!canPlace(x, z, { edge: 0.94, lake: 1.02, river: 0.28, slope: 1.15, minH: 0.4, maxH: 2.8 })) continue;
      const h = heightAt(x, z);
      const s = b[2];
      tempPos.set(x, h - 0.02, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * 1.1, s);
      tempM.compose(tempPos, tempQ, tempScale);
      bushMatrices.push(tempM.clone());
      bushColors.push(new THREE.Color().setHSL(0.96, 0.3, 0.55));
    }

    // scattered understory bushes
    for (let i = 0; i < 360; i++) {
      const a = rand() * TAU;
      const r = Math.sqrt(rand()) * 3.55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (lakeQ(x, z) < 1.22) continue;
      if (!canPlace(x, z, { edge: 0.94, lake: 1.22, river: 0.28, slope: 1.2, minH: 0.35, maxH: 2.15 })) continue;
      if (rand() > 0.32) continue;
      const h = heightAt(x, z);
      const s = randRange(0.45, 1.1);
      tempPos.set(x, h - 0.02, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * randRange(.7, 1.15), s);
      tempM.compose(tempPos, tempQ, tempScale);
      bushMatrices.push(tempM.clone());
      bushColors.push(new THREE.Color().setHSL(0.26 + rand() * 0.05, 0.22 + rand() * 0.1, 0.15 + rand() * 0.08));
    }
  })();

  function makeInstanced(geo, mat, matrices, colors, shadows) {
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      if (colors && colors[i]) mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!shadows;
    mesh.receiveShadow = !!shadows;
    mesh.frustumCulled = false;
    return mesh;
  }
  details.add(makeInstanced(treeTpl.broadTrunk, trunkMat, broadMatrices, null, true));
  details.add(makeInstanced(treeTpl.broadCanopy, treeCanopyMat, broadMatrices, broadColors, true));
  details.add(makeInstanced(treeTpl.coniferTrunk, trunkMat, coniferMatrices, null, true));
  details.add(makeInstanced(treeTpl.coniferCanopy, treeConiferMat, coniferMatrices, coniferColors, true));
  details.add(makeInstanced(treeTpl.bush, bushMat, bushMatrices, bushColors, false));
  details.add(makeInstanced(treeTpl.leafTufts, tuftMat, tuftMatrices, tuftColors, false));

  // A dusting of snow on the higher conifers.
  (function addConiferSnow() {
    const snowConeParts = [];
    const heights = [1.63, 1.89];
    const radii = [0.27, 0.12];
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.ConeGeometry(radii[i], 0.30, 9, 1);
      const m = new THREE.Matrix4().makeTranslation(0, heights[i], 0);
      snowConeParts.push({ geo, matrix: m });
    }
    // merge cones using the same tiny helper shape as above
    const posArr = [], normArr = [];
    for (const part of snowConeParts) {
      const g = part.geo.clone();
      g.applyMatrix4(part.matrix);
      const ni = g.index ? g.toNonIndexed() : g;
      posArr.push(...ni.getAttribute('position').array);
      normArr.push(...ni.getAttribute('normal').array);
      if (ni !== g) ni.dispose();
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    geo.computeVertexNormals();
    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xe4edf0, roughness: 0.9, metalness: 0,
      envMapIntensity: 0.3, bumpMap: clayBumpTex, bumpScale: 0.02, dithering: true
    });
    const snowMatrices = [];
    for (const m of coniferMatrices) {
      if (m.elements[13] > 1.25 && rand() < 0.82) snowMatrices.push(m.clone());
    }
    details.add(makeInstanced(geo, snowMat, snowMatrices, null, false));
  })();

  // A fine layer of individual leaves. The canopy gives the volume, these
  // cards give the close-up silhouette and the constant wind rustle.
  (function addLeafCards() {
    const leafGeo = (function makeLeafGeo() {
      const positions = [];
      const base = [0, -0.085, 0.0];
      const left = [-0.052, -0.012, 0.014];
      const right = [0.052, -0.012, -0.014];
      const tip = [0, 0.105, 0.003];
      const center = [0, 0.005, 0.026];
      const verts = [base, left, center, base, center, right, left, tip, center, center, tip, right];
      for (const v of verts) positions.push(v[0], v[1], v[2]);
      const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    })();

    const leafMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.5,
      emissive: new THREE.Color('#17230f'),
      emissiveIntensity: 0.35,
      dithering: true
    });
    addWind(leafMat, { strength: 0, yBias: 0, freq: 1, curl: 0.8, leaf: true, phase: 1.4 });

    const perTree = IS_MOBILE ? 190 : 650;
    const count = broadMatrices.length * perTree;
    const mesh = new THREE.InstancedMesh(leafGeo, leafMat, count);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const local = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scaleV = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const leafColor = new THREE.Color();
    let idx = 0;
    for (let t = 0; t < broadMatrices.length; t++) {
      const treeMat = broadMatrices[t];
      const baseTint = broadColors[t] || new THREE.Color('#6f8f4f');
      for (let j = 0; j < perTree; j++) {
        const theta = rand() * TAU;
        const v = rand() * 1.7 - 0.7;
        const rr = randRange(0.91, 1.22);
        const sx = Math.sqrt(1 - v * v);
        dir.set(Math.cos(theta) * sx, v, Math.sin(theta) * sx).normalize();
        pos.set(dir.x * 0.66 * rr, 1.10 + dir.y * 0.58 * rr, dir.z * 0.60 * rr);
        pos.x += randRange(-0.05, 0.05);
        pos.z += randRange(-0.05, 0.05);
        quat.setFromUnitVectors(up, dir);
        euler.set(randRange(-0.7, 0.7), randRange(0, TAU), randRange(-0.6, 0.6));
        quat.multiply(new THREE.Quaternion().setFromEuler(euler));
        const sc = randRange(0.48, 1.18);
        scaleV.set(sc * randRange(0.7, 1.25), sc, sc);
        local.compose(pos, quat, scaleV);
        world.multiplyMatrices(treeMat, local);
        mesh.setMatrixAt(idx, world);
        leafColor.copy(baseTint).offsetHSL(randRange(-0.02, 0.02), randRange(-0.04, 0.06), randRange(0.015, 0.09));
        leafColor.multiplyScalar(randRange(1.02, 1.5));
        mesh.setColorAt(idx, leafColor);
        idx++;
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    details.add(mesh);
  })();

  // Soft contact shadows keep the forest and its stems rooted in the soil.
  (function addTreeContactShadows() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: softTex,
      color: 0x000000,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false
    });
    const matrices = [];
    for (const tree of treePositions) {
      const h = heightAt(tree.x, tree.z);
      if (h > 1.55) continue;
      const s = tree.s || 0.6;
      const r = tree.type === 'conifer' ? s * 0.75 : s * 1.9;
      tempPos.set(tree.x, h + 0.025, tree.z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(r, 1, r * 1.05);
      tempM.compose(tempPos, tempQ, tempScale);
      matrices.push(tempM.clone());
    }
    const mesh = makeInstanced(geo, mat, matrices, null, false);
    mesh.renderOrder = 2;
    details.add(mesh);
  })();

  // ---------------------------------------------------------------------------
  // Hero trees generated in Tripo Studio, loaded asynchronously into the same
  // clay world. The base is sunk slightly so the tree grows out of the meadow.
  // ---------------------------------------------------------------------------
  (function addTripoHeroTrees() {
    if (!THREE.GLTFLoader) {
      console.warn('[Mistvale] GLTFLoader missing; hero trees skipped');
      return;
    }
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);

    const onLoad = (gltf) => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const center = box.getCenter(new THREE.Vector3());
      const baseY = box.min.y;
      source.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.envMapIntensity = 0.55;
          mat.needsUpdate = true;
        }
      });
      const heroSpots = (IS_MOBILE ? HERO_TREE_SPOTS.slice(0, 1) : HERO_TREE_SPOTS).filter(spot => Math.abs(spot.x - AUTUMN_TREE_SPOT.x) > 0.001 || Math.abs(spot.z - AUTUMN_TREE_SPOT.z) > 0.001);
      const heroTints = [0xffffff, 0xf0f2d6, 0xf6ead8, 0xe7eddf];
      for (let heroIndex = 0; heroIndex < heroSpots.length; heroIndex++) {
        const spot = heroSpots[heroIndex];
        const clone = source.clone(true);
        clone.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          o.material.color.setHex(heroTints[heroIndex % heroTints.length]);
          o.material.needsUpdate = true;
        });
        const wrap = new THREE.Group();
        wrap.add(clone);
        wrap.scale.setScalar(spot.s);
        wrap.rotation.y = spot.yaw;
        wrap.position.set(
          spot.x - center.x * spot.s,
          heightAt(spot.x, spot.z) - baseY * spot.s - 0.085,
          spot.z - center.z * spot.s
        );
        wrap.updateMatrixWorld(true);
        details.add(wrap);
      }
      if (window.__onHeroTreesReady) window.__onHeroTreesReady();
    };
    const onError = (err) => console.warn('[Mistvale] hero tree load failed', err);

    if (window.__HERO_TREE_B64__) {
      try {
        const raw = atob(window.__HERO_TREE_B64__);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        loader.parse(bytes.buffer, '', onLoad, onError);
      } catch (err) { onError(err); }
    } else {
      loader.load('assets/tripo/clay_tree_v1/resized.glb', onLoad, undefined, onError);
    }
  })();

  // ---------------------------------------------------------------------------
  // Snow-dusted fir trees generated in Tripo Studio.
  // ---------------------------------------------------------------------------
  (function addTripoConifers() {
    if (!THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    const onLoad = (gltf) => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const baseY = box.min.y;
      source.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.envMapIntensity = 0.6;
          mat.needsUpdate = true;
        }
      });
      const spots = IS_MOBILE ? CONIFER_SPOTS.slice(0, 1) : CONIFER_SPOTS;
      const targetHeight = 1.58;
      for (const spot of spots) {
        const scale = (targetHeight / Math.max(0.01, size.y)) * spot.scale;
        const clone = source.clone(true);
        const wrap = new THREE.Group();
        wrap.add(clone);
        wrap.scale.setScalar(scale);
        wrap.rotation.y = spot.yaw;
        wrap.position.set(
          spot.x - center.x * scale,
          heightAt(spot.x, spot.z) - baseY * scale - 0.035,
          spot.z - center.z * scale
        );
        wrap.updateMatrixWorld(true);
        details.add(wrap);
      }
    };
    const onError = (err) => console.warn('[Mistvale] conifer load failed', err);
    if (window.__CONIFER_B64__) {
      try {
        const raw = atob(window.__CONIFER_B64__);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        loader.parse(bytes.buffer, '', onLoad, onError);
      } catch (err) { onError(err); }
    } else {
      loader.load('assets/tripo/conifer_v1/resized.glb', onLoad, undefined, onError);
    }
  })();

  // ---------------------------------------------------------------------------
  // Mossy boulder clusters generated in Tripo Studio, rooted in the meadow.
  // ---------------------------------------------------------------------------
  (function addTripoRocks() {
    if (!THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: softTex, color: 0x000000, transparent: true, opacity: 0.16,
      depthWrite: false, blending: THREE.NormalBlending, toneMapped: false
    });
    const onLoad = (gltf) => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const baseY = box.min.y;
      source.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.envMapIntensity = 0.7;
          mat.needsUpdate = true;
        }
      });
      const spots = IS_MOBILE ? ROCK_SPOTS.slice(0, 2) : ROCK_SPOTS;
      for (const spot of spots) {
        const scale = spot.height / Math.max(0.01, size.y);
        const clone = source.clone(true);
        const wrap = new THREE.Group();
        wrap.add(clone);
        wrap.scale.setScalar(scale);
        wrap.rotation.y = spot.yaw;
        const gx = spot.x - center.x * scale;
        const gz = spot.z - center.z * scale;
        const gh = heightAt(spot.x, spot.z);
        wrap.position.set(gx, gh - baseY * scale - 0.045, gz);
        wrap.updateMatrixWorld(true);
        details.add(wrap);

        const sh = new THREE.Mesh(shadowGeo, shadowMat);
        sh.position.set(spot.x, gh + 0.026, spot.z);
        sh.scale.set(Math.max(size.x, size.z) * scale * 1.25, 1, Math.max(size.x, size.z) * scale * 1.15);
        sh.renderOrder = 2;
        details.add(sh);
      }
    };
    const onError = (err) => console.warn('[Mistvale] boulder load failed', err);
    if (window.__ROCK_B64__) {
      try {
        const raw = atob(window.__ROCK_B64__);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        loader.parse(bytes.buffer, '', onLoad, onError);
      } catch (err) { onError(err); }
    } else {
      loader.load('assets/tripo/rock_v1/resized.glb', onLoad, undefined, onError);
    }
  })();

  // ---------------------------------------------------------------------------
  // Autumn maple, graze doe and alpine crag: the final Tripo hero set.
  // ---------------------------------------------------------------------------
  (function addTripoAutumnTree() {
    if (!THREE.GLTFLoader || IS_MOBILE) return;
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    const onLoad = (gltf) => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const center = box.getCenter(new THREE.Vector3());
      const baseY = box.min.y;
      source.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.envMapIntensity = 0.6;
          mat.needsUpdate = true;
        }
      });
      const spot = AUTUMN_TREE_SPOT;
      const clone = source.clone(true);
      const wrap = new THREE.Group();
      wrap.add(clone);
      wrap.scale.setScalar(spot.s);
      wrap.rotation.y = spot.yaw;
      wrap.position.set(
        spot.x - center.x * spot.s,
        heightAt(spot.x, spot.z) - baseY * spot.s - 0.085,
        spot.z - center.z * spot.s
      );
      wrap.updateMatrixWorld(true);
      details.add(wrap);
    };
    const onError = (err) => console.warn('[Mistvale] autumn tree load failed', err);
    if (window.__AUTUMN_B64__) {
      try {
        const raw = atob(window.__AUTUMN_B64__);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        loader.parse(bytes.buffer, '', onLoad, onError);
      } catch (err) { onError(err); }
    } else {
      loader.load('assets/tripo/autumn_v1/optimized.glb', onLoad, undefined, onError);
    }
  })();

  (function addTripoDeer() {
    if (!THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: softTex, color: 0x000000, transparent: true, opacity: 0.2,
      depthWrite: false, blending: THREE.NormalBlending, toneMapped: false
    });
    const onLoad = (gltf) => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const baseY = box.min.y;
      source.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.envMapIntensity = 0.62;
          mat.needsUpdate = true;
        }
      });
      const spot = DEER_SPOT;
      const scale = spot.height / Math.max(0.01, size.y);
      const clone = source.clone(true);
      const wrap = new THREE.Group();
      wrap.add(clone);
      wrap.scale.setScalar(scale);
      wrap.rotation.y = spot.yaw;
      const gh = heightAt(spot.x, spot.z);
      wrap.position.set(spot.x - center.x * scale, gh - baseY * scale - 0.025, spot.z - center.z * scale);
      wrap.updateMatrixWorld(true);
      details.add(wrap);
      const sh = new THREE.Mesh(shadowGeo, shadowMat);
      sh.position.set(spot.x, gh + 0.027, spot.z);
      sh.scale.set(Math.max(size.x, size.z) * scale * 1.3, 1, Math.max(size.x, size.z) * scale * 1.1);
      sh.renderOrder = 2;
      details.add(sh);
    };
    const onError = (err) => console.warn('[Mistvale] deer load failed', err);
    if (window.__DEER_B64__) {
      try {
        const raw = atob(window.__DEER_B64__);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        loader.parse(bytes.buffer, '', onLoad, onError);
      } catch (err) { onError(err); }
    } else {
      loader.load('assets/tripo/deer_v1/optimized.glb', onLoad, undefined, onError);
    }
  })();

  (function addTripoCrags() {
    if (!THREE.GLTFLoader || IS_MOBILE) return;
    const loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    const onLoad = (gltf) => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(source);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const baseY = box.min.y;
      source.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.envMapIntensity = 0.55;
          mat.needsUpdate = true;
        }
      });
      for (const spot of CRAG_SPOTS) {
        const scale = spot.height / Math.max(0.01, size.y);
        const clone = source.clone(true);
        const wrap = new THREE.Group();
        wrap.add(clone);
        wrap.scale.setScalar(scale);
        wrap.rotation.y = spot.yaw;
        wrap.position.set(
          spot.x - center.x * scale,
          heightAt(spot.x, spot.z) - baseY * scale - 0.12,
          spot.z - center.z * scale
        );
        wrap.updateMatrixWorld(true);
        details.add(wrap);
      }
    };
    const onError = (err) => console.warn('[Mistvale] crag load failed', err);
    if (window.__CRAG_B64__) {
      try {
        const raw = atob(window.__CRAG_B64__);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        loader.parse(bytes.buffer, '', onLoad, onError);
      } catch (err) { onError(err); }
    } else {
      loader.load('assets/tripo/crag_v1/optimized.glb', onLoad, undefined, onError);
    }
  })();

  /* -------------------------------------------------------------------------
     Grass & tiny flowers
     ------------------------------------------------------------------------- */
  function buildBladeGeometry() {
    const positions = [];
    const colors = [];
    const indices = [];
    const up = new THREE.Vector3(0, 1, 0);
    const bladeCount = 5;
    for (let i = 0; i < bladeCount; i++) {
      const angle = (i / bladeCount) * TAU + randRange(-0.4, 0.4);
      const height = 0.135 + (i % 3) * 0.032 + rand() * 0.028;
      const baseOff = randRange(0.006, 0.035);
      const width = randRange(0.012, 0.019);
      const curve = randRange(0.035, 0.085);
      const sideX = -Math.sin(angle);
      const sideZ = Math.cos(angle);
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const segments = 5;
      const base = positions.length / 3;
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        const y = Math.pow(t, 0.94) * height;
        const x = dirX * (baseOff + curve * t * t);
        const z = dirZ * (baseOff + curve * t * t);
        const w = width * (1.0 - t * 0.94) * (1.0 + Math.sin(t * Math.PI) * 0.45);
        const left = j === segments ? 0 : w;
        const c = 0.58 + t * 0.48 + (i % 2) * 0.06;
        const idx = positions.length / 3;
        positions.push(x - sideX * left, y, z - sideZ * left);
        positions.push(x + sideX * left, y, z + sideZ * left);
        colors.push(c * 0.98, c * 1.04, c * 0.82);
        colors.push(c * 0.98, c * 1.04, c * 0.82);
        if (j > 0) {
          const a = base + (j - 1) * 2;
          indices.push(a, a + 1, idx);
          indices.push(a + 1, idx + 1, idx);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
  const grass = (function addGrass() {
    const max = IS_MOBILE ? 1800 : 4800;
    const matrices = [];
    const colors = [];
    const blade = buildBladeGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
      envMapIntensity: 0.24,
      bumpMap: clayBumpTex,
      bumpScale: 0.012,
      dithering: true
    });
    addWind(mat, { strength: 2.1, yBias: 0, freq: 2.15, curl: 0.76, phase: 0.4 });
    for (let i = 0; i < max * 3; i++) {
      const a = rand() * TAU;
      const r = Math.sqrt(rand()) * 3.62;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (lakeQ(x, z) < 1.02) continue;
      if (distToRiver(x, z) < 0.24) continue;
      if (slopeAt(x, z) > 1.08) continue;
      const h = heightAt(x, z);
      if (h > 1.92) continue;
      const s = randRange(0.58, 1.3);
      tempPos.set(x, h + 0.005, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * randRange(0.7, 1.35), s);
      tempM.compose(tempPos, tempQ, tempScale);
      matrices.push(tempM.clone());
      colors.push(new THREE.Color().setHSL(0.22 + rand() * 0.07, 0.3 + rand() * 0.2, 0.18 + rand() * 0.15));
      if (matrices.length >= max) break;
    }
    const mesh = makeInstanced(blade, mat, matrices, colors, false);
    // small independent forelock in the front meadow for close-up depth
    const clumpMats = [];
    for (let i = 0; i < 240; i++) {
      const a = randRange(0.7, 1.9);
      const r = randRange(0.9, 2.9);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!canPlace(x, z, { edge: 0.94, lake: 1.06, river: 0.28, slope: 1.0, minH: 0.45, maxH: 2.05 })) continue;
      const h = heightAt(x, z);
      const s = randRange(0.65, 1.4);
      tempPos.set(x, h + 0.006, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * randRange(0.8, 1.6), s);
      tempM.compose(tempPos, tempQ, tempScale);
      clumpMats.push(tempM.clone());
    }
    const clump = makeInstanced(blade, mat, clumpMats, null, false);
    details.add(mesh);
    details.add(clump);
    return mesh;
  })();
  (function addFlowers() {
    function mergeColoredParts(parts) {
      const positions = [], normals = [], colors = [];
      for (const part of parts) {
        let g = part.geo.clone();
        if (part.matrix) g.applyMatrix4(part.matrix);
        if (g.index) {
          const ni = g.toNonIndexed();
          g.dispose();
          g = ni;
        }
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        const c = part.color;
        for (let i = 0; i < p.count; i++) {
          positions.push(p.getX(i), p.getY(i), p.getZ(i));
          normals.push(n.getX(i), n.getY(i), n.getZ(i));
          colors.push(c.r, c.g, c.b);
        }
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    }

    const variants = [
      { petal: '#f2e8d1', inner: '#fbf3df', center: '#d3a74e', stem: '#4b653c', leaves: '#607b48' },
      { petal: '#e1a3b2', inner: '#f0c0cb', center: '#dfbd64', stem: '#425d39', leaves: '#587344' },
      { petal: '#b7a6d7', inner: '#d3c8e9', center: '#d6c47e', stem: '#405b3a', leaves: '#536f45' },
      { petal: '#eac075', inner: '#f7dda6', center: '#b98837', stem: '#48613a', leaves: '#5d7844' }
    ];

    const variantsData = [];
    for (let v = 0; v < variants.length; v++) {
      const spec = variants[v];
      const petalColor = new THREE.Color(spec.petal);
      const innerColor = new THREE.Color(spec.inner);
      const stemColor = new THREE.Color(spec.stem);
      const leafColor = new THREE.Color(spec.leaves);
      const centerColor = new THREE.Color(spec.center);

      const parts = [];
      // slender curved-looking stem: two narrow tapered segments
      const stemGeo = new THREE.CylinderGeometry(0.005, 0.010, 0.24, 5, 1);
      parts.push({ geo: stemGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.12, 0), color: stemColor });
      // two little leaves on the stem
      const leafPetal = new THREE.SphereGeometry(1, 6, 4);
      for (let l = 0; l < 2; l++) {
        const side = l === 0 ? -1 : 1;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(side * 0.028, 0.10 + l * 0.035, 0.006),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2 * side, 0.5 * side, 0.7 * side)),
          new THREE.Vector3(0.030, 0.005, 0.012)
        );
        parts.push({ geo: leafPetal, matrix: m, color: leafColor });
      }
      // outer petals
      const petalGeo = new THREE.SphereGeometry(1, 8, 5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.12;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * 0.048, 0.255 + (i % 2) * 0.003, Math.sin(a) * 0.048),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, -a, 0.18)),
          new THREE.Vector3(0.045, 0.013, 0.024)
        );
        parts.push({ geo: petalGeo, matrix: m, color: petalColor });
      }
      // inner petals, slightly lifted
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.7;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * 0.027, 0.268, Math.sin(a) * 0.027),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.38, -a, 0.15)),
          new THREE.Vector3(0.030, 0.011, 0.016)
        );
        parts.push({ geo: petalGeo, matrix: m, color: innerColor });
      }
      // seed head
      const centerGeo = new THREE.SphereGeometry(1, 7, 5);
      parts.push({
        geo: centerGeo,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(0, 0.275, 0),
          new THREE.Quaternion(),
          new THREE.Vector3(0.022, 0.018, 0.022)
        ),
        color: centerColor
      });
      // tiny green calyx below the petals
      parts.push({
        geo: new THREE.ConeGeometry(0.028, 0.05, 6),
        matrix: new THREE.Matrix4().makeTranslation(0, 0.238, 0),
        color: stemColor
      });
      const geo = mergeColoredParts(parts);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.77, metalness: 0,
        vertexColors: true, side: THREE.DoubleSide,
        envMapIntensity: 0.4, dithering: true
      });
      addWind(mat, { strength: 0.62, yBias: 0.02, freq: 1.5, curl: 0.82, space: 0.5, phase: v * 0.7 });
      variantsData.push({ geo, mat, matrices: [], colors: [] });
    }

    for (let i = 0; i < 1500; i++) {
      const a = rand() * TAU;
      const r = 0.7 + Math.sqrt(rand()) * 2.9;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!canPlace(x, z, { edge: 0.95, lake: 1.05, river: 0.3, slope: 1.0, minH: 0.45, maxH: 1.95 })) continue;
      if (rand() > 0.36) continue;
      const h = heightAt(x, z);
      const s = randRange(0.72, 1.42);
      tempPos.set(x, h + 0.002, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * randRange(0.9, 1.2), s);
      tempM.compose(tempPos, tempQ, tempScale);
      const v = Math.floor(rand() * variantsData.length);
      variantsData[v].matrices.push(tempM.clone());
    }

    // extra hand-placed clusters close to the lake edge so the eye finds them
    const clusters = [[2.15, 3.15], [2.35, 2.95], [-1.35, 2.9], [0.15, 3.25], [-0.4, 2.8]];
    for (let c = 0; c < clusters.length; c++) {
      for (let i = 0; i < 8; i++) {
        const x = clusters[c][0] + randRange(-.16, .16);
        const z = clusters[c][1] + randRange(-.16, .16);
        if (!canPlace(x, z, { edge: 0.97, lake: 1.04, river: 0.25, slope: 1.1, minH: 0.45, maxH: 2.0 })) continue;
        const h = heightAt(x, z);
        const s = randRange(0.9, 1.5);
        tempPos.set(x, h + 0.003, z);
        tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
        tempScale.set(s, s, s);
        tempM.compose(tempPos, tempQ, tempScale);
        const v = Math.floor(rand() * variantsData.length);
        variantsData[v].matrices.push(tempM.clone());
      }
    }
    for (const data of variantsData) {
      details.add(makeInstanced(data.geo, data.mat, data.matrices, null, false));
    }
  })();

  // ferns — arching, pinnate silhouettes for the forest floor
  (function addFerns() {
    const positions = [], normals = [], colors = [], indices = [];
    const up = new THREE.Vector3(0, 1, 0);
    const fronds = 7;
    for (let f = 0; f < fronds; f++) {
      const angle = (f / fronds) * TAU + randRange(-0.1, 0.1);
      const dirX = Math.cos(angle), dirZ = Math.sin(angle);
      const sideX = -dirZ, sideZ = dirX;
      const length = randRange(0.34, 0.46);
      const baseHeight = randRange(0.02, 0.08);
      const steps = 7;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const cx = dirX * length * t;
        const cz = dirZ * length * t;
        const cy = baseHeight + Math.sin(t * Math.PI * 0.78) * 0.22 + t * 0.02;
        const tangentX = dirX * length * (1.0 / steps);
        const tangentZ = dirZ * length * (1.0 / steps);
        const leafLen = 0.075 * (1.0 - t * 0.52) + 0.012;
        const leafW = 0.015 * (1.0 - t * 0.2) + 0.005;
        for (const side of [-1, 1]) {
          const tipX = cx + sideX * side * leafLen + tangentX * 0.22;
          const tipZ = cz + sideZ * side * leafLen + tangentZ * 0.22;
          const tipY = cy + 0.025;
          const baseX = cx + tangentX * 0.3;
          const baseZ = cz + tangentZ * 0.3;
          const baseY = cy;
          const idx = positions.length / 3;
          positions.push(baseX - tangentX * 0.5, baseY, baseZ - tangentZ * 0.5);
          positions.push(baseX + tangentX * 0.5, baseY + 0.006, baseZ + tangentZ * 0.5);
          positions.push(tipX, tipY, tipZ);
          const c0 = new THREE.Color('#355937').lerp(new THREE.Color('#7b9b58'), t * 0.7 + rand() * 0.2);
          for (let k = 0; k < 3; k++) colors.push(c0.r, c0.g, c0.b);
          indices.push(idx, idx + 1, idx + 2);
        }
      }
      // a thin rachis strip
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const x0 = dirX * length * t0, z0 = dirZ * length * t0;
        const y0 = baseHeight + Math.sin(t0 * Math.PI * 0.78) * 0.22;
        const x1 = dirX * length * t1, z1 = dirZ * length * t1;
        const y1 = baseHeight + Math.sin(t1 * Math.PI * 0.78) * 0.22;
        const w = 0.006;
        const idx = positions.length / 3;
        positions.push(x0 - sideX * w, y0, z0 - sideZ * w);
        positions.push(x0 + sideX * w, y0, z0 + sideZ * w);
        positions.push(x1 - sideX * w, y1, z1 - sideZ * w);
        positions.push(x1 + sideX * w, y1, z1 + sideZ * w);
        const c = new THREE.Color('#45653d');
        for (let k = 0; k < 4; k++) colors.push(c.r, c.g, c.b);
        indices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.86, metalness: 0,
      vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.22,
      dithering: true
    });
    addWind(mat, { strength: 0.4, yBias: 0.02, freq: 1.45, curl: 0.8, space: 0.48, phase: 2.1 });
    const matrices = [], colors2 = [];
    for (let i = 0; i < 700; i++) {
      const a = rand() * TAU;
      const r = 0.8 + Math.sqrt(rand()) * 2.75;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!canPlace(x, z, { edge: 0.94, lake: 1.08, river: 0.28, slope: 1.15, minH: 0.4, maxH: 2.1 })) continue;
      if (rand() > 0.3) continue;
      const h = heightAt(x, z);
      const s = randRange(0.6, 1.45);
      tempPos.set(x, h + 0.004, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * randRange(0.8, 1.25), s);
      tempM.compose(tempPos, tempQ, tempScale);
      matrices.push(tempM.clone());
      colors2.push(new THREE.Color().setHSL(0.25 + rand() * 0.04, 0.25, 0.35 + rand() * 0.15));
    }
    details.add(makeInstanced(geo, mat, matrices, colors2, false));
  })();

  /* -------------------------------------------------------------------------
     Rocks and shoreline pebbles
     ------------------------------------------------------------------------- */
  (function addRocks() {
    const rockGeo = (function makeRockGeo() {
      const geo = new THREE.IcosahedronGeometry(1, 3);
      const p = geo.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = fbm(v.x * 1.8 + 2.7, v.z * 1.8 - 1.4, 3) * 0.5 + fbm(v.x * 4.1 - 1.2, v.y * 4.1 + 3.1, 2) * 0.22;
        const scl = 0.82 + n * 0.35;
        p.setXYZ(i, v.x * scl, v.y * scl * 0.86, v.z * scl);
      }
      geo.computeVertexNormals();
      const n = geo.getAttribute('normal');
      const colors = new Float32Array(p.count * 3);
      const stone = new THREE.Color('#6d685c');
      const dark = new THREE.Color('#403e3a');
      const moss = new THREE.Color('#576c43');
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const up = n.getY(i);
        const grain = 0.82 + fbm(p.getX(i) * 8.0 + 3.0, p.getZ(i) * 8.0 - 1.0, 2) * 0.35;
        c.copy(dark).lerp(stone, smoothstep(-0.75, 0.35, y) * 0.8 + 0.15);
        c.lerp(moss, smoothstep(0.32, 0.9, up) * (0.35 + rand() * 0.38) * smoothstep(-0.3, 0.5, y));
        c.multiplyScalar(grain);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    })();
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.94, metalness: 0,
      vertexColors: true, flatShading: false, envMapIntensity: 0.3, dithering: true
    });
    const matrices = [], colors = [];
    for (let i = 0; i < 160; i++) {
      const a = rand() * TAU;
      const r = Math.sqrt(rand()) * 3.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = heightAt(x, z);
      const nearWater = (lakeQ(x, z) < 1.42 && lakeQ(x, z) > 0.9) || distToRiver(x, z) < 0.72;
      const scattered = h < 2.0 && slopeAt(x, z) < 0.7 && rand() < 0.24;
      if (!nearWater && !scattered) continue;
      if (lakeQ(x, z) < 0.85) continue;
      if (!nearWater && h > 2.05) continue;
      const s = nearWater ? randRange(0.05, 0.19) : randRange(0.04, 0.12);
      tempPos.set(x + randRange(-.15, .15), h + s * 0.2, z + randRange(-.15, .15));
      tempQ.setFromEuler(new THREE.Euler(rand() * 3, rand() * TAU, rand() * 3));
      tempScale.set(s * randRange(.75, 1.5), s * randRange(.55, 1.1), s * randRange(.8, 1.35));
      tempM.compose(tempPos, tempQ, tempScale);
      matrices.push(tempM.clone());
      colors.push(new THREE.Color().setRGB(randRange(0.72, 1.02), randRange(0.72, 1.0), randRange(0.7, 0.98)));
    }
    // waterfall lip boulders
    for (let i = 0; i < 9; i++) {
      const a = rand() * TAU;
      const rr = 0.18 + rand() * 0.38;
      const x = RIVER_LEDGE.x + Math.cos(a) * rr;
      const z = RIVER_LEDGE.z + Math.sin(a) * rr;
      const h = heightAt(x, z);
      const s = randRange(0.12, 0.32);
      tempPos.set(x, h + s * 0.22, z);
      tempQ.setFromEuler(new THREE.Euler(rand() * 3, rand() * TAU, rand() * 3));
      tempScale.set(s, s * 0.72, s * 1.05);
      tempM.compose(tempPos, tempQ, tempScale);
      matrices.push(tempM.clone());
      colors.push(new THREE.Color().setRGB(randRange(0.68, 0.96), randRange(0.68, 0.94), randRange(0.66, 0.92)));
    }
    details.add(makeInstanced(rockGeo, rockMat, matrices, colors, true));

    // a scatter of small pebbles for the shoreline and mountain foot
    const pebMatrices = [], pebColors = [];
    for (let i = 0; i < 420; i++) {
      const a = rand() * TAU;
      const r = Math.sqrt(rand()) * 3.55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const nearLake = lakeQ(x, z) < 1.38 && lakeQ(x, z) > 0.9;
      const nearRiver = distToRiver(x, z) < 0.5;
      const h = heightAt(x, z);
      if (h > 2.0) continue;
      if (!nearLake && !nearRiver && rand() > 0.2) continue;
      if (lakeQ(x, z) < 0.88) continue;
      const s = randRange(0.018, 0.055);
      tempPos.set(x, h + s * 0.25, z);
      tempQ.setFromEuler(new THREE.Euler(rand() * 3, rand() * TAU, rand() * 3));
      tempScale.set(s * randRange(0.7, 1.5), s * randRange(0.5, 0.9), s * randRange(0.7, 1.35));
      tempM.compose(tempPos, tempQ, tempScale);
      pebMatrices.push(tempM.clone());
      pebColors.push(new THREE.Color().setRGB(randRange(0.6, 1.0), randRange(0.6, 0.98), randRange(0.58, 0.95)));
    }
    details.add(makeInstanced(rockGeo, rockMat, pebMatrices, pebColors, false));
  })();

  /* -------------------------------------------------------------------------
     Clouds
     ------------------------------------------------------------------------- */
  const clouds = [];
  const cloudTextures = [];
  (function buildCloudTextures() {
    for (let v = 0; v < 3; v++) {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 420;
      const g = c.getContext('2d');
      function puff(x, y, rx, ry, a) {
        g.save();
        g.translate(x, y);
        g.scale(rx / 100, ry / 100);
        const grd = g.createRadialGradient(-12, -20, 0, 0, 0, 100);
        grd.addColorStop(0, `rgba(255,255,252,${a})`);
        grd.addColorStop(0.55, `rgba(255,252,245,${a * 0.88})`);
        grd.addColorStop(0.82, `rgba(244,245,243,${a * 0.34})`);
        grd.addColorStop(1, 'rgba(238,243,247,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(0, 0, 100, 0, TAU);
        g.fill();
        g.restore();
      }
      const ox = (v - 1) * 10;
      puff(330 + ox, 285, 150, 92, 0.86);
      puff(455 + ox, 292, 170, 96, 0.88);
      puff(585 + ox, 282, 135, 85, 0.84);
      puff(290 + ox, 255, 78, 74, 0.9);
      puff(370 + ox, 220, 86, 92, 0.94);
      puff(455 + ox, 190, 76, 86, 0.95);
      puff(530 + ox, 215, 82, 84, 0.93);
      puff(610 + ox, 250, 74, 75, 0.89);
      puff(665 + ox, 278, 52, 53, 0.7);
      puff(240 + ox, 280, 55, 50, 0.68);
      puff(410 + ox, 160, 50, 48, 0.82);
      puff(480 + ox, 158, 42, 40, 0.76);
      puff(350 + ox, 170, 36, 34, 0.5);
      puff(560 + ox, 185, 32, 29, 0.44);
      g.globalCompositeOperation = 'source-atop';
      let topg = g.createLinearGradient(250, 100, 560, 280);
      topg.addColorStop(0, 'rgba(255,226,188,.36)');
      topg.addColorStop(0.5, 'rgba(255,244,224,.14)');
      topg.addColorStop(1, 'rgba(210,225,241,0)');
      g.fillStyle = topg;
      g.fillRect(0, 0, 900, 420);
      let botg = g.createLinearGradient(0, 250, 0, 410);
      botg.addColorStop(0, 'rgba(125,147,171,0)');
      botg.addColorStop(0.65, 'rgba(118,139,162,.20)');
      botg.addColorStop(1, 'rgba(104,127,152,.3)');
      g.fillStyle = botg;
      g.fillRect(0, 220, 900, 200);
      g.globalCompositeOperation = 'source-over';
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      cloudTextures.push(tex);
    }
  })();

  const cloudSpecs = [
    { x: -2.55, y: 6.62, z: 0.45, w: 3.60, speed: 0.026, phase: 0.0, tex: 0, op: 0.94 },
    { x: 2.72, y: 7.17, z: -1.20, w: 2.85, speed: 0.019, phase: 1.7, tex: 1, op: 0.9 },
    { x: -2.95, y: 5.18, z: -2.20, w: 1.28, speed: 0.018, phase: 4.5, tex: 2, op: 0.48 },
    { x: 3.02, y: 5.50, z: 2.05, w: 1.55, speed: 0.031, phase: 2.2, tex: 2, op: 0.55 },
    { x: 0.42, y: 7.92, z: -2.45, w: 1.18, speed: 0.016, phase: 5.2, tex: 0, op: 0.4 }
  ];
  for (let c = 0; c < cloudSpecs.length; c++) {
    const spec = cloudSpecs[c];
    const group = new THREE.Group();
    group.position.set(spec.x, spec.y, spec.z);
    const ratio = 420 / 900;

    const mainMat = new THREE.SpriteMaterial({
      map: cloudTextures[spec.tex],
      color: 0xfff4e2,
      transparent: true,
      opacity: spec.op,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending
    });
    const main = new THREE.Sprite(mainMat);
    main.scale.set(spec.w, spec.w * ratio, 1);
    main.renderOrder = 8;
    group.add(main);

    const wispMat = new THREE.SpriteMaterial({
      map: cloudTextures[(spec.tex + 1) % 3],
      color: 0xf4f0e9,
      transparent: true,
      opacity: spec.op * 0.36,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending
    });
    const wisp = new THREE.Sprite(wispMat);
    wisp.scale.set(spec.w * 0.82, spec.w * ratio * 0.7, 1);
    wisp.position.set(spec.w * 0.2, -spec.w * ratio * 0.12, -0.02);
    wisp.renderOrder = 8.1;
    group.add(wisp);

    const veilMat = new THREE.SpriteMaterial({
      map: softTex,
      color: 0xffe5bd,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const veil = new THREE.Sprite(veilMat);
    veil.scale.set(spec.w * 1.7, spec.w * ratio * 1.25, 1);
    veil.renderOrder = 7;
    group.add(veil);

    const shineMat = new THREE.SpriteMaterial({
      map: cloudTextures[spec.tex],
      color: 0xffe0b0,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });
    const shine = new THREE.Sprite(shineMat);
    shine.scale.set(spec.w * 0.9, spec.w * ratio * 0.86, 1);
    shine.position.set(-spec.w * 0.06, spec.w * ratio * 0.08, 0.03);
    shine.renderOrder = 8.2;
    group.add(shine);

    group.userData = {
      baseX: spec.x, baseY: spec.y, baseZ: spec.z,
      speed: spec.speed, phase: spec.phase, width: spec.w,
      mainMat, wispMat, veilMat, shineMat,
      main, wisp, shine, veil,
      wispBaseX: wisp.position.x, wispBaseY: wisp.position.y, wispBaseZ: wisp.position.z,
      mainScaleX: main.scale.x, mainScaleY: main.scale.y,
      mainBase: spec.op, wispBase: spec.op * 0.36
    };
    scene.add(group);
    clouds.push(group);
  }

  /* -------------------------------------------------------------------------
     Atmosphere — light shafts, valley mist, motes & fireflies
     ------------------------------------------------------------------------- */
  const atmosphere = new THREE.Group();
  scene.add(atmosphere);

  const shaftUniformsList = [];
  const shafts = [];
  (function addLightShafts() {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    const specs = [
      { x: -1.65, z: -1.95, y: 4.54, w: 4.6, h: 8.7, roll: -0.16, base: 0.095 },
      { x: -2.55, z: -1.05, y: 4.36, w: 2.8, h: 8.5, roll: 0.24, base: 0.065 },
      { x: 0.15, z: -2.55, y: 4.08, w: 3.2, h: 7.8, roll: 0.30, base: 0.05 },
      { x: -1.2, z: 1.92, y: 4.70, w: 2.2, h: 8.7, roll: -0.24, base: 0.14 }
    ];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const uniforms = {
        uTime: { value: 0 },
        uOpacity: { value: spec.base },
        uColor: { value: new THREE.Color('#ffe1b9') }
      };
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          precision highp float;
          uniform float uTime;
          uniform float uOpacity;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main(){
            float x = (vUv.x - 0.5) * 2.0;
            float core = exp(-pow(x / 0.36, 2.0));
            float vertical = smoothstep(0.0, 0.20, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
            float n1 = 0.5 + 0.5 * sin(vUv.x * 10.0 + sin(vUv.y * 12.0 + uTime * 0.15) * 2.8);
            float n2 = 0.5 + 0.5 * sin(vUv.x * 29.0 - vUv.y * 8.0 - uTime * 0.10);
            float n = n1 * 0.64 + n2 * 0.36;
            float streak = smoothstep(0.20, 0.82, n);
            float alpha = core * vertical * (0.12 + 0.88 * streak) * uOpacity;
            vec3 col = uColor * (0.66 + 0.55 * streak);
            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(spec.x, spec.y, spec.z);
      mesh.scale.set(spec.w, spec.h, 1);
      mesh.renderOrder = 9;
      mesh.userData.roll = spec.roll;
      mesh.userData.base = spec.base;
      atmosphere.add(mesh);
      shafts.push(mesh);
      shaftUniformsList.push(uniforms);
    }
  })();

  const mistSprites = [];
  (function addValleyMist() {
    const positions = [
      [0.95, 1.9, 1.25], [-0.2, 2.25, 0.95], [2.05, 2.2, 0.8], [1.55, 2.8, 0.4],
      [-1.4, 2.9, 0.5], [0.35, 3.05, 0.25], [2.35, 1.0, 1.05], [-0.55, 0.55, 1.3],
      [-2.55, 2.0, 0.6], [1.8, -0.55, 0.75], [-2.0, -0.35, 0.55], [0.55, -1.15, 0.5],
      [2.7, 2.5, 0.3], [-2.75, -0.7, 0.4], [0.0, 1.25, 1.15], [1.1, 0.1, 0.9],
      [-1.1, 1.65, 0.7], [2.2, 1.85, 0.6], [-2.1, 1.2, 0.4], [0.8, 2.5, 1.3],
      [-0.65, 2.05, 0.55], [1.45, 1.55, 0.5]
    ];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const h = heightAt(p[0], p[1]);
      if (lakeQ(p[0], p[1]) < 0.9) {
        // hovering just above the water
      }
      const isLake = lakeQ(p[0], p[1]) < 1.4;
      const y = isLake ? LAKE_LEVEL + 0.10 + p[2] * 0.2 : h + 0.12 + p[2] * 0.45;
      const mat = new THREE.SpriteMaterial({
        map: softTex,
        color: i % 4 === 0 ? 0xd9e4df : 0xb7cdc9,
        transparent: true,
        opacity: randRange(0.045, 0.105),
        depthWrite: false,
        blending: i % 5 === 0 ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      const sprite = new THREE.Sprite(mat);
      const s = randRange(0.85, 1.95) * (isLake ? 1.2 : 1);
      sprite.scale.set(s * randRange(1.55, 2.35), s * randRange(.42, .72), 1);
      sprite.position.set(p[0] + randRange(-.2, .2), y, p[1] + randRange(-.2, .2));
      sprite.userData = {
        baseX: sprite.position.x, baseY: y, baseZ: sprite.position.z,
        seed: rand() * 10, speed: randRange(0.06, 0.14), amp: randRange(0.1, 0.3),
        baseOpacity: sprite.material.opacity
      };
      sprite.renderOrder = 10;
      atmosphere.add(sprite);
      mistSprites.push(sprite);
    }

    function addFogBank(x, z, y, sx, sy, opacity, warm) {
      const mat = new THREE.SpriteMaterial({
        map: softTex,
        color: warm ? 0xffdfc0 : 0xc6d6d8,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(sx, sy, 1);
      sprite.position.set(x, y, z);
      sprite.userData = {
        baseX: x, baseY: y, baseZ: z, seed: rand() * 10,
        speed: randRange(0.035, 0.085), amp: randRange(0.1, 0.28),
        baseOpacity: opacity
      };
      sprite.renderOrder = 11;
      atmosphere.add(sprite);
      mistSprites.push(sprite);
    }
    addFogBank(-0.5, 2.35, 0.98, 4.6, 0.95, 0.045, true);
    addFogBank(1.6, 1.55, 0.85, 3.4, 0.72, 0.05, false);
    addFogBank(-2.1, 1.75, 0.72, 3.1, 0.7, 0.045, true);
    addFogBank(0.35, 2.85, 0.62, 2.8, 0.62, 0.04, false);
    addFogBank(2.05, -1.2, 1.05, 3.5, 0.8, 0.045, true);
    addFogBank(-1.4, -0.5, 1.35, 2.5, 0.7, 0.04, false);
  })();

  const motes = (function addDustMotes() {
    const count = IS_MOBILE ? 60 : 130;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const base = [];
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(rand()) * 4.15;
      const a = rand() * TAU;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = randRange(1.2, 8.0);
      base.push({ x, y, z, phase: rand() * TAU, speed: randRange(.18, .42), amp: randRange(.08, .34) });
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      seed[i] = rand();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTex,
      color: 0xffe5b7,
      size: 0.065,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 12;
    atmosphere.add(points);
    points.userData = { base, pos };
    return points;
  })();

  const fireflies = (function addFireflies() {
    const count = IS_MOBILE ? 55 : 110;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      const a = rand() * TAU;
      const r = Math.sqrt(rand()) * 3.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h > 2.8 || lakeQ(x, z) < 1.0) { i--; continue; }
      pos[i * 3] = x;
      pos[i * 3 + 1] = h + randRange(0.18, 1.2);
      pos[i * 3 + 2] = z;
      seeds.push({ x, z, baseY: pos[i * 3 + 1], phase: rand() * TAU, speed: randRange(.5, 1.25), amp: randRange(.1, .4) });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: glowTex,
      color: 0xffdc8d,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 13;
    atmosphere.add(points);
    points.userData = { seeds, pos };
    return points;
  })();

  /* -------------------------------------------------------------------------
     Tiny inhabitants — deer, rabbits, birds, koi; and the small things
     that hold the scene together: mushrooms, lily pads, a fallen log.
     ------------------------------------------------------------------------- */
  const life = new THREE.Group();
  scene.add(life);

  function clayMaterial(color, roughness) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: roughness === undefined ? 0.9 : roughness,
      metalness: 0,
      envMapIntensity: 0.35,
      dithering: true
    });
  }

  function setShadows(obj) {
    obj.traverse(n => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });
  }

  function addAnimalShadow(parent, radius, opacity) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: softTex,
      color: 0x000000,
      transparent: true,
      opacity: opacity ?? 0.3,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false
    });
    const shadow = new THREE.Mesh(geo, mat);
    shadow.scale.set(radius * 1.5, 1, radius * 1.65);
    shadow.position.y = 0.018;
    shadow.renderOrder = 2;
    shadow.castShadow = false;
    shadow.receiveShadow = false;
    parent.add(shadow);
    return shadow;
  }

  const deerFur = clayMaterial('#b78c68', 0.93);
  const deerCream = clayMaterial('#e1cbb2', 0.94);
  const deerDark = clayMaterial('#4b3a2d', 0.9);
  const antlerMat = clayMaterial('#d3c19d', 0.86);

  function makeDeer(scale, antlers) {
    const g = new THREE.Group();
    const coat = deerFur.clone();
    const cream = deerCream.clone();
    coat.color.offsetHSL(randRange(-.01, .01), randRange(-.03, .03), randRange(-.035, .035));

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), coat);
    body.scale.set(0.26, 0.155, 0.12);
    body.position.set(0, 0.33, 0);
    g.add(body);

    const rump = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), coat);
    rump.scale.set(0.135, 0.14, 0.112);
    rump.position.set(-0.17, 0.335, 0);
    g.add(rump);

    const neck = new THREE.Group();
    neck.position.set(0.18, 0.37, 0);
    g.add(neck);
    const neckMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.047, 0.14, 6, 12), coat);
    neckMesh.rotation.z = -0.46;
    neckMesh.position.set(0.035, 0.09, 0);
    neck.add(neckMesh);

    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), coat);
    head.scale.set(0.095, 0.078, 0.065);
    head.position.set(0.085, 0.205, 0);
    neck.add(head);

    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cream);
    muzzle.scale.set(0.06, 0.042, 0.042);
    muzzle.position.set(0.16, 0.18, 0);
    neck.add(muzzle);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 5), deerDark);
    nose.position.set(0.218, 0.184, 0);
    neck.add(nose);

    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), deerDark);
      eye.position.set(0.115, 0.226, s * 0.052);
      neck.add(eye);

      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.11, 8), coat);
      ear.position.set(0.045, 0.28, s * 0.058);
      ear.rotation.z = s * 0.38;
      ear.rotation.x = s * 0.18;
      neck.add(ear);

      const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.072, 8), cream);
      earInner.position.set(0.058, 0.282, s * 0.061);
      earInner.rotation.z = s * 0.38;
      earInner.rotation.x = s * 0.18;
      neck.add(earInner);

      if (antlers) {
        const root = new THREE.Group();
        root.position.set(0.035, 0.295, s * 0.033);
        neck.add(root);
        const makeBone = (x1, y1, z1, x2, y2, z2, r) => {
          const a = new THREE.Vector3(x1, y1, z1);
          const b = new THREE.Vector3(x2, y2, z2);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const dir = b.clone().sub(a);
          const len = dir.length();
          const geo = new THREE.CylinderGeometry(r, r * 1.2, len, 4);
          const mesh = new THREE.Mesh(geo, antlerMat);
          mesh.position.copy(mid);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          root.add(mesh);
          return mesh;
        };
        makeBone(0, 0, 0, 0.01, 0.12, s * 0.03, 0.008);
        makeBone(0.01, 0.12, s * 0.03, 0.07, 0.18, s * 0.055, 0.006);
        makeBone(0.01, 0.12, s * 0.03, -0.04, 0.19, s * 0.08, 0.0055);
      }
    }

    const tail = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cream);
    tail.scale.set(0.045, 0.06, 0.035);
    tail.position.set(-0.27, 0.37, 0);
    g.add(tail);

    const legs = [];
    for (const lx of [-0.15, 0.14]) {
      for (const lz of [-0.075, 0.075]) {
        const pivot = new THREE.Group();
        pivot.position.set(lx, 0.25, lz);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.015, 0.22, 8), coat);
        leg.position.y = -0.10;
        pivot.add(leg);
        const hoof = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 4), deerDark);
        hoof.scale.set(0.9, 0.5, 1.1);
        hoof.position.y = -0.21;
        pivot.add(hoof);
        g.add(pivot);
        legs.push(pivot);
      }
    }

    const ears = [];
    neck.traverse(n => {
      if (n.isMesh && n.geometry && n.geometry.type === 'ConeGeometry' && n.position.y > 0.24) ears.push(n);
    });
    g.scale.setScalar(scale);
    g.userData = { neck, legs, body, tail, ears, earBase: ears.map(e => e.rotation.z), phase: rand() * TAU, baseNeck: 0, baseScale: scale };
    setShadows(g);
    addAnimalShadow(g, 0.3 * scale, 0.3);
    return g;
  }
  const animalRigs = [];
  {
    const buck = makeDeer(1.18, true);
    const path = { cx: 1.36, cz: 3.24, rx: 0.4, rz: 0.09 };
    const a0 = 0.6;
    const bx = path.cx + Math.cos(a0) * path.rx;
    const bz = path.cz + Math.sin(a0) * path.rz;
    buck.position.set(bx, heightAt(bx, bz) + 0.01, bz);
    buck.rotation.y = Math.atan2(-Math.cos(a0) * path.rz, -Math.sin(a0) * path.rx);
    buck.userData.path = path;
    buck.userData.pathAngle = a0;
    buck.userData.walkSpeed = 0.3;
    buck.userData.stepFreq = 4.4;
    buck.userData.baseGround = heightAt(bx, bz);
    life.add(buck);
    animalRigs.push({ obj: buck, type: 'deerWalk', phase: 0.4 });

    const doe = makeDeer(1.02, false);
    const dx = 2.34, dz = 2.92;
    doe.position.set(dx, heightAt(dx, dz) + 0.01, dz);
    doe.rotation.y = -2.42;
    doe.userData.baseGround = heightAt(dx, dz);
    life.add(doe);
    animalRigs.push({ obj: doe, type: 'deerGraze', phase: 2.2 });
  }

  function makeRabbit(scale) {
    const g = new THREE.Group();
    const coat = clayMaterial('#b5a28f', 0.94);
    const cream = clayMaterial('#e3d5c5', 0.94);
    const dark = clayMaterial('#55483d', 0.9);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), coat);
    body.scale.set(0.11, 0.105, 0.09);
    body.position.y = 0.11;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 9), coat);
    head.scale.set(0.075, 0.075, 0.068);
    head.position.set(0.085, 0.19, 0);
    g.add(head);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cream);
    muzzle.scale.set(0.045, 0.034, 0.036);
    muzzle.position.set(0.14, 0.17, 0);
    g.add(muzzle);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 5, 4), dark);
    nose.position.set(0.18, 0.18, 0);
    g.add(nose);
    const ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.115, 3, 6), coat);
      ear.position.set(0.055, 0.31, s * 0.038);
      ear.rotation.z = s * 0.1 - 0.08;
      ear.rotation.x = s * 0.16;
      g.add(ear);
      ears.push(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 5, 4), dark);
      eye.position.set(0.13, 0.205, s * 0.048);
      g.add(eye);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), cream);
    tail.scale.set(.05, .05, .04);
    tail.position.set(-0.11, 0.12, 0);
    g.add(tail);
    g.scale.setScalar(scale);
    g.userData = { ears, phase: rand() * TAU, baseY: 0 };
    setShadows(g);
    addAnimalShadow(g, 0.115 * scale, 0.26);
    return g;
  }

  {
    const rabbitSpots = [[-1.32, 2.55, 0.88], [-1.58, 2.18, 0.78], [2.92, 3.10, 0.7]];
    for (let i = 0; i < rabbitSpots.length; i++) {
      const p = rabbitSpots[i];
      const r = makeRabbit(p[2]);
      const y = heightAt(p[0], p[1]);
      r.position.set(p[0], y + 0.01, p[1]);
      r.rotation.y = randRange(-3, 3);
      r.userData.baseY = y;
      r.userData.baseX = p[0];
      r.userData.baseZ = p[1];
      life.add(r);
      animalRigs.push({ obj: r, type: 'rabbit', angle: rand() * TAU, speed: randRange(.7, 1.2), amount: 0.35 });
    }
  }

  const birdGroup = new THREE.Group();
  life.add(birdGroup);
  const birds = [];
  (function addBirds() {
    const birdMat = new THREE.MeshStandardMaterial({
      color: 0xf0e7d8,
      roughness: 0.86,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.4
    });
    const darkMat = clayMaterial('#5b4a3c', 0.9);
    function makeBird() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), birdMat);
      body.scale.set(0.12, 0.025, 0.028);
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 7, 5), birdMat);
      head.position.set(0.10, 0.015, 0);
      g.add(head);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.10, 4), birdMat);
      tail.position.set(-0.12, 0.005, 0);
      tail.rotation.z = Math.PI / 2;
      g.add(tail);
      const wings = [];
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(0.015, 0.01, s * 0.028);
        const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 4), birdMat);
        wing.scale.set(0.105, 0.006, 0.065);
        wing.position.set(-0.01, 0, s * 0.06);
        pivot.add(wing);
        g.add(pivot);
        wings.push(pivot);
      }
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.035, 4), darkMat);
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.13, 0.014, 0);
      g.add(beak);
      g.userData.wings = wings;
      setShadows(g);
      return g;
    }
    for (let i = 0; i < 9; i++) {
      const b = makeBird();
      b.scale.setScalar(randRange(1.3, 1.9));
      birdGroup.add(b);
      birds.push({
        mesh: b,
        radius: randRange(1.1, 2.6),
        height: randRange(4.55, 6.55),
        speed: randRange(.3, .52) * (i % 2 ? 1 : -1),
        phase: rand() * TAU,
        centerX: randRange(-.7, .4),
        centerZ: randRange(-1.2, .4),
        wingSpeed: randRange(17, 25)
      });
    }
  })();

  // lily pads and koi
  const lilyPads = [];
  const koi = [];
  (function addLakeLife() {
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x5d7d47,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.25
    });
    const padGeo = new THREE.CircleGeometry(1, 22, 0.22, TAU - 0.55);
    const pads = [
      [0.52, 2.05, 0.20], [1.30, 2.48, 0.15], [0.82, 2.52, 0.12],
      [1.68, 2.00, 0.16], [1.48, 2.66, 0.10], [0.35, 2.37, 0.12]
    ];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const mesh = new THREE.Mesh(padGeo, padMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rand() * TAU;
      mesh.position.set(LAKE.x - 0.6 + p[0], LAKE_LEVEL + 0.008 + i * 0.0004, LAKE.z - 0.5 + p[1]);
      mesh.scale.setScalar(p[2]);
      mesh.renderOrder = 4;
      life.add(mesh);
      lilyPads.push(mesh);
    }
    // a small lotus
    const lotus = new THREE.Group();
    const petalMat = clayMaterial('#e6c6c3', 0.8);
    const centerMat = clayMaterial('#d8b15e', 0.8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), petalMat);
      petal.scale.set(0.036, 0.012, 0.018);
      petal.position.set(Math.cos(a) * 0.032, 0.025, Math.sin(a) * 0.032);
      petal.rotation.set(0, -a, 0.42);
      lotus.add(petal);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), centerMat);
    core.position.y = 0.035;
    lotus.add(core);
    lotus.position.set(LAKE.x + 0.25, LAKE_LEVEL + 0.013, LAKE.z + 0.45);
    life.add(lotus);

    const koiMaterials = [
      clayMaterial('#c67d4b', 0.58),
      clayMaterial('#ded1b3', 0.6),
      clayMaterial('#b7563e', 0.58)
    ];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), koiMaterials[i % 3]);
      body.scale.set(0.115, 0.032, 0.04);
      g.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.11, 7), koiMaterials[i % 3]);
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -0.10;
      g.add(tail);
      g.position.set(LAKE.x - .35 + i * .22, LAKE_LEVEL - 0.09, LAKE.z - .18 + (i % 2) * .27);
      g.userData = { phase: rand() * TAU, speed: .48 + i * .09, radiusX: .25 + i * .05, radiusZ: .15 + (i % 2) * .06, cx: g.position.x, cz: g.position.z, tail, swimPhase: rand() * TAU };
      life.add(g);
      koi.push(g);
    }
  })();

  // Butterflies — small bright punctuation marks drifting over the meadow.
  const butterflies = [];
  (function addButterflies() {
    function wingGeometry(mirror) {
      const positions = [];
      const side = mirror ? -1 : 1;
      const pts = [
        [0.075, 0, 0.012], [0.145, 0, 0.055], [0.105, 0, 0.135], [0.008, 0, 0.065],
        [0.025, 0, 0.012], [-0.045, 0, 0.06], [-0.07, 0, 0.125], [-0.005, 0, 0.055]
      ];
      for (const p of pts) positions.push(p[0], p[1], p[2] * side);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
      geo.computeVertexNormals();
      return geo;
    }
    const colors = ['#e7ad6b', '#c29ad5', '#e8cc7b', '#a9cbd5'];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const bodyMat = clayMaterial('#584637', 0.82);
      const wingMat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length], roughness: 0.58, metalness: 0.0,
        side: THREE.DoubleSide, transparent: true, opacity: 0.92,
        emissive: new THREE.Color(colors[i % colors.length]).multiplyScalar(0.08),
        envMapIntensity: 0.45
      });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.08, 3, 6), bodyMat);
      body.rotation.z = Math.PI / 2;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), bodyMat);
      head.position.x = 0.052;
      g.add(head);
      const wings = [];
      for (const mirror of [false, true]) {
        const pivot = new THREE.Group();
        pivot.position.set(0, 0, 0);
        const wing = new THREE.Mesh(wingGeometry(mirror), wingMat);
        pivot.add(wing);
        g.add(pivot);
        wings.push(pivot);
      }
      // antennae
      for (const side of [-1, 1]) {
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0025, 0.06, 4), bodyMat);
        antenna.position.set(0.065, 0.025, side * 0.018);
        antenna.rotation.z = -0.9;
        antenna.rotation.x = side * 0.25;
        g.add(antenna);
      }
      g.scale.setScalar(randRange(1.35, 1.9));
      g.traverse(n => { if (n.isMesh) n.castShadow = false; });
      life.add(g);
      butterflies.push({
        mesh: g, wings,
        cx: randRange(-1.2, 1.7), cz: randRange(2.0, 3.1),
        radiusX: randRange(0.3, 0.65), radiusZ: randRange(0.25, 0.5),
        height: randRange(0.85, 1.55), speed: randRange(0.16, 0.3),
        phase: rand() * TAU, wingSpeed: randRange(16, 24)
      });
    }
  })();

  // Reeds, rushes and a handful of petals on the water.
  const floatingPetals = [];
  (function addShoreDetails() {
    function mergeColored(parts) {
      const pos = [], nor = [], col = [];
      for (const part of parts) {
        let g = part.geo.clone();
        if (part.matrix) g.applyMatrix4(part.matrix);
        if (g.index) {
          const ni = g.toNonIndexed(); g.dispose(); g = ni;
        }
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        for (let i = 0; i < p.count; i++) {
          pos.push(p.getX(i), p.getY(i), p.getZ(i));
          nor.push(n.getX(i), n.getY(i), n.getZ(i));
          col.push(part.color.r, part.color.g, part.color.b);
        }
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      return geo;
    }
    const reedGreen = new THREE.Color('#647a45');
    const reedStem = new THREE.Color('#7a834c');
    const reedHead = new THREE.Color('#8a6845');
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + randRange(-.3, .3);
      const h = randRange(0.34, 0.62);
      const lean = randRange(0.03, 0.12);
      const x = Math.cos(a) * randRange(0.01, 0.05);
      const z = Math.sin(a) * randRange(0.01, 0.05);
      const tipX = x + Math.cos(a) * lean;
      const tipZ = z + Math.sin(a) * lean;
      const dir = new THREE.Vector3(tipX - x, h, tipZ - z);
      const stemLen = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      const stemGeo = new THREE.CylinderGeometry(0.0045, 0.009, stemLen, 4, 1);
      parts.push({
        geo: stemGeo,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x + (tipX - x) * 0.5, h * 0.5, z + (tipZ - z) * 0.5),
          q, new THREE.Vector3(1, 1, 1)
        ),
        color: i % 3 === 0 ? reedStem : reedGreen
      });
      // seed head at the tip
      const headGeo = new THREE.CapsuleGeometry(0.012, 0.05, 2, 4);
      parts.push({
        geo: headGeo,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(tipX, h + 0.027, tipZ),
          q, new THREE.Vector3(1, 1, 1)
        ),
        color: reedHead
      });
      // narrow leaf
      const leafGeo = new THREE.ConeGeometry(0.018, 0.17, 4);
      const leafQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5 + randRange(-.3, .3), a + Math.PI / 2, 0.8));
      parts.push({
        geo: leafGeo,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x + Math.cos(a) * 0.09, 0.12, z + Math.sin(a) * 0.09),
          leafQ, new THREE.Vector3(0.72, 1, 0.5)
        ),
        color: reedGreen
      });
    }
    const reedGeo = mergeColored(parts);
    const reedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.84, metalness: 0,
      vertexColors: true, side: THREE.DoubleSide,
      envMapIntensity: 0.22, dithering: true
    });
    addWind(reedMat, { strength: 0.48, yBias: 0.02, freq: 1.25, curl: 0.8, phase: 1.1 });

    const matrices = [];
    for (let i = 0; i < 120; i++) {
      let x, z, h;
      if (i < 78) {
        const a = rand() * TAU;
        const q = randRange(1.01, 1.13);
        x = LAKE.x + Math.cos(a) * LAKE.rx * q;
        z = LAKE.z + Math.sin(a) * LAKE.rz * q;
      } else {
        const t = randRange(0.36, 0.94);
        const p = riverCurve.getPointAt(t);
        const tangent = riverCurve.getTangentAt(t);
        const side = rand() > 0.5 ? 1 : -1;
        const off = randRange(0.32, 0.62);
        x = p.x - tangent.z * off * side;
        z = p.z + tangent.x * off * side;
      }
      h = heightAt(x, z);
      if (lakeQ(x, z) < 0.98) continue;
      if (h < 0.25 || h > 2.05) continue;
      const s = randRange(0.7, 1.35);
      tempPos.set(x, h + 0.002, z);
      tempQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * TAU);
      tempScale.set(s, s * randRange(0.8, 1.3), s);
      tempM.compose(tempPos, tempQ, tempScale);
      matrices.push(tempM.clone());
    }
    details.add(makeInstanced(reedGeo, reedMat, matrices, null, false));

    const petalGeo = new THREE.CircleGeometry(0.025, 6);
    const petalMat = new THREE.MeshStandardMaterial({
      color: 0xecc3c2, roughness: 0.84, metalness: 0,
      side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      envMapIntensity: 0.35, dithering: true
    });
    for (let i = 0; i < 10; i++) {
      const petal = new THREE.Mesh(petalGeo, petalMat);
      const a = rand() * TAU;
      const rr = randRange(0.15, 0.9);
      petal.rotation.x = -Math.PI / 2;
      petal.rotation.z = rand() * TAU;
      petal.position.set(LAKE.x + Math.cos(a) * LAKE.rx * rr, LAKE_LEVEL + 0.018, LAKE.z + Math.sin(a) * LAKE.rz * rr);
      petal.userData = { phase: rand() * TAU, baseX: petal.position.x, baseZ: petal.position.z };
      petal.renderOrder = 4;
      life.add(petal);
      floatingPetals.push(petal);
    }
  })();

  // mushrooms: tiny clusters, a few of them faintly phosphorescent
  const glowingMushroomMats = [];
  (function addMushrooms() {
    const stemMat = clayMaterial('#d8cbb4', 0.94);
    const capMats = [
      clayMaterial('#a65343', 0.86),
      clayMaterial('#c68663', 0.86),
      clayMaterial('#8d4d3a', 0.86)
    ];
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x7fb8a9,
      roughness: 0.6,
      emissive: new THREE.Color('#4fc7aa'),
      emissiveIntensity: 0.3,
      metalness: 0,
      transparent: true,
      opacity: 0.88
    });
    glowingMushroomMats.push(glowMat);
    const clusters = [
      [2.25, 3.12], [2.46, 3.02], [-2.55, 1.72], [-2.38, 1.60], [1.75, 3.15],
      [-1.15, 1.65], [2.78, 1.94], [-2.00, 2.23], [0.18, 2.95]
    ];
    for (let c = 0; c < clusters.length; c++) {
      const base = clusters[c];
      const count = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const x = base[0] + randRange(-.13, .13);
        const z = base[1] + randRange(-.13, .13);
        const h = heightAt(x, z);
        if (lakeQ(x, z) < 1.08) continue;
        const s = randRange(0.6, 1.1);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(.012, .017, .07, 5), stemMat);
        stem.position.set(x, h + .035 * s, z);
        stem.scale.setScalar(s);
        life.add(stem);
        const isGlow = c >= 6 && i === 0;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(.043, 8, 5, 0, TAU, 0, Math.PI * 0.52), isGlow ? glowMat : capMats[(c + i) % capMats.length]);
        cap.scale.set(s, s * .62, s);
        cap.position.set(x, h + .078 * s, z);
        cap.rotation.z = randRange(-.12, .12);
        life.add(cap);
      }
    }
  })();

  // fallen log across the stream
  (function addLogBridge() {
    const t = 0.585;
    const p = riverCurve.getPoint(t);
    const tangent = riverCurve.getTangent(t);
    const h = heightAt(p.x, p.z);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(.055, .075, 1.05, 8), clayMaterial('#5e4934', 0.96));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = Math.atan2(-tangent.x, -tangent.z);
    log.position.set(p.x, h + .10, p.z);
    log.castShadow = true;
    log.receiveShadow = true;
    life.add(log);

    const mossMat = clayMaterial('#536b3d', 0.92);
    for (let i = 0; i < 5; i++) {
      const moss = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), mossMat);
      const tt = randRange(-.4, .4);
      moss.scale.set(randRange(.05, .1), .022, randRange(.04, .07));
      moss.position.set(
        p.x + Math.cos(log.rotation.y) * tt,
        h + .16 + randRange(-.01, .015),
        p.z - Math.sin(log.rotation.y) * tt
      );
      life.add(moss);
    }
  })();

  // a few small stones stacked into a cairn on the open meadow
  (function addCairn() {
    const x = -1.05, z = 2.72;
    const baseH = heightAt(x, z);
    const mat = clayMaterial('#746c5f', 0.98);
    let h = baseH;
    for (let i = 0; i < 4; i++) {
      const s = 0.075 - i * 0.011;
      const geo = new THREE.DodecahedronGeometry(s, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + randRange(-.01, .01), h + s * 0.55, z + randRange(-.01, .01));
      m.rotation.set(rand(), rand() * 6, rand());
      m.scale.y = 0.62;
      m.castShadow = true;
      life.add(m);
      h += s * 0.85;
    }
  })();

  // A low collar of cloud around the floating island, and two small drifting
  // fragments of the same world inside the glass.
  const baseClouds = [];
  (function addBaseClouds() {
    const specs = [
      { x: -3.0, y: 0.35, z: 1.55, w: 3.1, op: 0.28, tex: 0 },
      { x: 2.65, y: 0.30, z: 0.85, w: 2.7, op: 0.23, tex: 1 },
      { x: -0.35, y: 0.18, z: 2.85, w: 2.9, op: 0.22, tex: 2 },
      { x: 2.9, y: 0.48, z: -1.55, w: 2.0, op: 0.17, tex: 0 }
    ];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const mat = new THREE.SpriteMaterial({
        map: cloudTextures[spec.tex],
        color: 0xd7e1e2,
        transparent: true,
        opacity: spec.op,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(spec.x, spec.y, spec.z);
      sprite.scale.set(spec.w, spec.w * (420 / 900) * 0.8, 1);
      sprite.renderOrder = 8.5;
      sprite.userData = { baseX: spec.x, baseY: spec.y, baseZ: spec.z, baseOp: spec.op, texIndex: spec.tex };
      scene.add(sprite);
      baseClouds.push(sprite);
    }
  })();

  const floatingIslets = [];
  (function addFloatingIslets() {
    const specs = [
      { x: -3.45, y: 3.15, z: 2.35, s: 0.24, phase: 0.4 },
      { x: 3.55, y: 4.05, z: -2.35, s: 0.2, phase: 2.2 }
    ];
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x675a49, roughness: 0.96, flatShading: true, envMapIntensity: 0.25 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5f7d4b, roughness: 0.94, envMapIntensity: 0.25 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x574331, roughness: 0.95 });
    const needleMat = new THREE.MeshStandardMaterial({ color: 0x46664d, roughness: 0.9 });
    for (const spec of specs) {
      const islet = new THREE.Group();
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.47, 0), rockMat);
      stone.scale.set(1, 0.58, 0.9);
      stone.rotation.set(0.2, 0.4, 0.1);
      islet.add(stone);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.43, 9, 6), grassMat);
      top.scale.set(1.0, 0.22, 0.83);
      top.position.y = 0.18;
      islet.add(top);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.45, 5), woodMat);
      trunk.position.set(0.05, 0.45, -0.05);
      islet.add(trunk);
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2 - i * 0.045, 0.26, 7), needleMat);
        cone.position.set(0.05, 0.58 + i * 0.16, -0.05);
        islet.add(cone);
      }
      // a couple of dangling roots
      for (let i = 0; i < 3; i++) {
        const root = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.013, 0.32, 4), woodMat);
        root.position.set(randRange(-.2, .24), -0.35, randRange(-.18, .2));
        root.rotation.z = randRange(-.25, .25);
        root.rotation.x = randRange(-.2, .2);
        islet.add(root);
      }
      islet.position.set(spec.x, spec.y, spec.z);
      islet.scale.setScalar(spec.s);
      islet.userData = { baseX: spec.x, baseY: spec.y, baseZ: spec.z, s: spec.s, phase: spec.phase };
      scene.add(islet);
      floatingIslets.push(islet);
    }
  })();

  // Petals that drift down through the cube, looping forever.
  const petalSprites = [];
  (function addPetalFall() {
    const count = IS_MOBILE ? 16 : 28;
    const palette = [0xf4d0c7, 0xf6e5d4, 0xe9b4bf, 0xfff1dc];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: petalTex,
        color: palette[i % palette.length],
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending
      });
      const s = new THREE.Sprite(mat);
      s.position.set(randRange(-4.1, 4.1), randRange(1.0, 8.2), randRange(-4.1, 4.1));
      s.scale.setScalar(randRange(0.06, 0.13));
      s.material.rotation = rand() * TAU;
      s.renderOrder = 13;
      s.userData = {
        fall: randRange(0.12, 0.36),
        drift: randRange(0.08, 0.35),
        phase: rand() * TAU,
        spin: randRange(-0.5, 0.5),
        baseOpacity: randRange(0.4, 0.8)
      };
      scene.add(s);
      petalSprites.push(s);
    }
  })();

  // Slightly enlarge the little world inside its glass case. The landscape,
  // inhabitants and their shadows all share one root so every contact stays true.
  const worldRoot = new THREE.Group();
  worldRoot.scale.setScalar(1.065);
  worldRoot.add(terrainGroup);
  worldRoot.add(details);
  worldRoot.add(life);
  worldRoot.add(atmosphere);
  scene.add(worldRoot);

  /* -------------------------------------------------------------------------
     Post processing
     ------------------------------------------------------------------------- */
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  const postVert = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const RT_TYPE = (renderer.capabilities.isWebGL2
    ? renderer.extensions.has('EXT_color_buffer_float')
    : renderer.extensions.has('EXT_color_buffer_half_float')) ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const sceneRT = new THREE.WebGLRenderTarget(2, 2, {
    type: RT_TYPE,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
    samples: renderer.capabilities.isWebGL2 ? (IS_MOBILE ? 2 : 4) : 0,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

  const blurA = new THREE.WebGLRenderTarget(2, 2, {
    type: RT_TYPE, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
  });
  const blurB = blurA.clone();
  const bloomA = blurA.clone();
  const bloomB = blurA.clone();

  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uDirection: { value: new THREE.Vector2(1, 0) },
      uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uRadius: { value: 1.6 }
    },
    vertexShader: postVert,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec2 uDirection;
      uniform vec2 uTexel;
      uniform float uRadius;
      varying vec2 vUv;
      void main(){
        vec2 step = uDirection * uTexel * uRadius;
        vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
        c += (texture2D(tDiffuse, vUv + step * 1.3846).rgb + texture2D(tDiffuse, vUv - step * 1.3846).rgb) * 0.15873;
        c += (texture2D(tDiffuse, vUv + step * 3.2308).rgb + texture2D(tDiffuse, vUv - step * 3.2308).rgb) * 0.09442;
        c += (texture2D(tDiffuse, vUv + step * 5.1765).rgb + texture2D(tDiffuse, vUv - step * 5.1765).rgb) * 0.04548;
        c += (texture2D(tDiffuse, vUv + step * 7.2765).rgb + texture2D(tDiffuse, vUv - step * 7.2765).rgb) * 0.01685;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });

  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uThreshold: { value: 0.92 },
      uSoftKnee: { value: 0.35 }
    },
    vertexShader: postVert,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform float uThreshold;
      uniform float uSoftKnee;
      varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float knee = uSoftKnee;
        float soft = clamp((lum - uThreshold + knee) / (2.0 * knee + 0.0001), 0.0, 1.0);
        soft = soft * soft * knee;
        float contribution = max(soft, lum - uThreshold) / max(lum, 0.0001);
        gl_FragColor = vec4(c * contribution, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });

  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      tBlur: { value: null },
      tBloom: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uExposure: { value: 1.14 },
      uBlurAmount: { value: 0.92 },
      uWarmth: { value: 0.8 },
      uNight: { value: 0.0 }
    },
    vertexShader: postVert,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tScene;
      uniform sampler2D tBlur;
      uniform sampler2D tBloom;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uExposure;
      uniform float uBlurAmount;
      uniform float uWarmth;
      uniform float uNight;
      varying vec2 vUv;

      float hash(vec2 p){
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      vec3 aces(vec3 x){
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      vec3 linearToSRGB(vec3 c){
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      void main(){
        vec2 uv = vUv;
        vec2 centered = uv - 0.5;
        float ca = dot(centered, centered) * 0.0018;
        vec3 sharp;
        sharp.r = texture2D(tScene, uv - centered * ca).r;
        sharp.g = texture2D(tScene, uv).g;
        sharp.b = texture2D(tScene, uv + centered * ca).b;

        // gentle local-contrast recovery in the focused band
        vec2 px = 1.0 / uResolution;
        vec3 localAvg = (
          texture2D(tScene, uv + vec2(px.x, 0.0)).rgb +
          texture2D(tScene, uv - vec2(px.x, 0.0)).rgb +
          texture2D(tScene, uv + vec2(0.0, px.y)).rgb +
          texture2D(tScene, uv - vec2(0.0, px.y)).rgb
        ) * 0.25;
        sharp += (sharp - localAvg) * 0.12;

        // macro / tilt-shift band of focus, with a soft falloff
        float band = smoothstep(0.05, 0.42, abs(uv.y - 0.425));
        band = max(band, smoothstep(0.43, 0.72, abs(centered.x)) * 0.6);
        float blurMix = clamp(band * uBlurAmount, 0.0, 0.94);
        vec3 blurred = texture2D(tBlur, uv).rgb;
        vec3 color = mix(sharp, blurred, blurMix);

        // halation from the brightest glass edges, water glints & sun shafts
        vec3 bloom = texture2D(tBloom, uv).rgb;
        color += bloom * 0.82;

        // soft grade: warm light, cool shadow, creamy contrast
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color *= uExposure;
        color = mix(vec3(luma), color, 1.13);
        vec3 split = mix(vec3(0.92, 0.985, 1.075), vec3(1.065, 1.005, 0.925), smoothstep(0.01, 0.52, luma));
        color *= split;
        color += vec3(-0.004, 0.002, 0.016) * (1.0 - smoothstep(0.0, 0.34, luma));
        color += vec3(0.024, 0.008, -0.006) * smoothstep(0.32, 1.0, luma);

        // vignette
        vec2 vc = centered * vec2(1.0, 0.94);
        float vig = smoothstep(0.90, 0.22, length(vc) * 1.12);
        color *= 0.66 + 0.34 * vig;

        // ACES tonemap then display transform
        color = aces(color);
        color = linearToSRGB(color);
        color = mix(color, color * color * (3.0 - 2.0 * color), 0.16);
        float postLuma = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(postLuma), color, 1.15);

        // film grain + tiny blue-noise dither
        float grain = hash(uv * uResolution + fract(uTime) * 311.7) - 0.5;
        color += grain * (0.021 + 0.022 * (1.0 - smoothstep(0.0, 0.65, luma)));
        color += (hash(uv * uResolution * 1.73) - 0.5) / 255.0;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });

  function renderPass(material, target) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  /* -------------------------------------------------------------------------
     Camera interaction
     ------------------------------------------------------------------------- */
  const cam = {
    az: 0.715,
    el: 0.445,
    radius: 33,
    targetRadius: 33,
    targetAz: 0.715,
    targetEl: 0.445,
    target: new THREE.Vector3(0, 4.05, 0),
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastInput: 0,
    fitRadius: 33,
    userZoomed: false
  };

  function computeFitRadius() {
    const aspect = Math.max(0.35, window.innerWidth / window.innerHeight);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const forHeight = 18.2 / (2 * Math.tan(fovRad * 0.5));
    const forWidth = (IS_MOBILE ? 14.3 : 15.2) / (2 * Math.tan(fovRad * 0.5) * aspect);
    return Math.max(forHeight, forWidth) * (IS_MOBILE ? 1.03 : 1.0);
  }

  function resetCamera() {
    cam.targetAz = 0.715;
    cam.targetEl = 0.445;
    cam.targetRadius = cam.fitRadius;
    cam.radius = cam.fitRadius * 1.03;
    cam.userZoomed = false;
  }

  function updateCamera(dt, time) {
    if (!cam.dragging && !REDUCED_MOTION) {
      const idle = Math.sin(time * 0.055) * 0.012 + Math.sin(time * 0.023 + 1.3) * 0.007;
      cam.targetAz += idle * dt * 0.3;
    }
    const k = cam.dragging ? 18 : 4.2;
    cam.az = damp(cam.az, cam.targetAz, k, dt);
    cam.el = damp(cam.el, cam.targetEl, k, dt);
    cam.radius = damp(cam.radius, cam.targetRadius, 5.0, dt);

    const ce = Math.cos(cam.el), se = Math.sin(cam.el);
    camera.position.set(
      cam.target.x + Math.sin(cam.az) * ce * cam.radius,
      cam.target.y + se * cam.radius,
      cam.target.z + Math.cos(cam.az) * ce * cam.radius
    );
    camera.lookAt(cam.target);
  }

  canvas.addEventListener('pointerdown', (e) => {
    cam.dragging = true;
    cam.lastX = e.clientX;
    cam.lastY = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    cam.lastInput = performance.now();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cam.dragging) return;
    const dx = e.clientX - cam.lastX;
    const dy = e.clientY - cam.lastY;
    cam.lastX = e.clientX;
    cam.lastY = e.clientY;
    cam.targetAz -= dx * 0.0032;
    cam.targetEl = clamp(cam.targetEl + dy * 0.0024, 0.16, 0.92);
    cam.targetAz = clamp(cam.targetAz, -0.75, 2.18);
    cam.lastInput = performance.now();
  });
  const endDrag = (e) => {
    cam.dragging = false;
    canvas.classList.remove('dragging');
    if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', (e) => { if (cam.dragging) endDrag(e); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const min = cam.fitRadius * 0.46;
    const max = cam.fitRadius * 1.36;
    cam.targetRadius = clamp(cam.targetRadius + e.deltaY * 0.013, min, max);
    cam.userZoomed = true;
  }, { passive: false });

  canvas.addEventListener('dblclick', resetCamera);

  // touch pinch
  let pinch = null;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinch = Math.hypot(dx, dy);
      cam.dragging = false;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinch) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d = Math.hypot(dx, dy);
        const min = cam.fitRadius * 0.46, max = cam.fitRadius * 1.36;
        cam.targetRadius = clamp(cam.targetRadius - (d - pinch) * 0.045, min, max);
        cam.userZoomed = true;
        pinch = d;
      }
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => { pinch = null; }, { passive: true });

  /* -------------------------------------------------------------------------
     Time of day & UI
     ------------------------------------------------------------------------- */
  let timeOfDay = 0.71;
  let autoTime = !REDUCED_MOTION;
  const DAY_PERIOD = 1080; // seconds for a full 24h cycle
  let uiAccum = 0;

  const rangeEl = document.getElementById('timeRange');
  const clockEl = document.getElementById('clock');
  const phaseEl = document.getElementById('phaseLabel');
  const playBtn = document.getElementById('playBtn');
  const pauseIcon = document.getElementById('pauseIcon');
  const playIcon = document.getElementById('playIcon');
  const resetBtn = document.getElementById('resetBtn');

  function phaseName(phase) {
    const h = phase * 24;
    if (h < 5.0) return '深夜 · NIGHT';
    if (h < 8.0) return '破晓 · DAWN';
    if (h < 11.0) return '晨光 · MORNING';
    if (h < 16.0) return '白昼 · DAYLIGHT';
    if (h < 19.2) return '黄昏 · GOLDEN HOUR';
    if (h < 20.4) return '暮色 · TWILIGHT';
    return '夜 · NIGHT';
  }
  function updateTimeUI(force) {
    const h = timeOfDay * 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    clockEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    phaseEl.textContent = phaseName(timeOfDay);
    if (!rangeEl.matches(':active')) rangeEl.value = String(Math.round(timeOfDay * 1000));
  }
  function setPlayState(on) {
    autoTime = on;
    pauseIcon.style.display = on ? 'block' : 'none';
    playIcon.style.display = on ? 'none' : 'block';
    playBtn.setAttribute('aria-label', on ? '暂停昼夜流转' : '播放昼夜流转');
  }
  setPlayState(autoTime);
  updateTimeUI(true);

  playBtn.addEventListener('click', () => {
    setPlayState(!autoTime);
    updateTimeUI(true);
  });
  resetBtn.addEventListener('click', () => {
    resetCamera();
    setPlayState(true);
  });
  rangeEl.addEventListener('input', () => {
    timeOfDay = clamp(parseInt(rangeEl.value, 10) / 1000, 0, 1);
    setPlayState(false);
    updateTimeUI(true);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.target.matches('input, button')) {
      e.preventDefault();
      setPlayState(!autoTime);
      updateTimeUI(true);
    }
    if (e.key.toLowerCase() === 'r' && !e.target.matches('input, button')) resetCamera();
  });

  /* -------------------------------------------------------------------------
     Resize / render targets
     ------------------------------------------------------------------------- */
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  let sizeW = 1, sizeH = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    sizeW = w; sizeH = h;
    sceneRT.setSize(w, h);
    const hw = Math.max(2, Math.floor(w * 0.5));
    const hh = Math.max(2, Math.floor(h * 0.5));
    const qw = Math.max(2, Math.floor(w * 0.25));
    const qh = Math.max(2, Math.floor(h * 0.25));
    blurA.setSize(hw, hh);
    blurB.setSize(hw, hh);
    bloomA.setSize(qw, qh);
    bloomB.setSize(qw, qh);
    bgMat.uniforms.uResolution.value.set(w, h);
    finalMat.uniforms.uResolution.value.set(w, h);
    cam.fitRadius = computeFitRadius();
    if (!cam.userZoomed) {
      cam.targetRadius = cam.fitRadius;
      if (!camera.userData.initialized) {
        cam.radius = cam.fitRadius * 1.025;
        camera.userData.initialized = true;
      }
    }
  }
  window.addEventListener('resize', resize);
  resize();

  /* -------------------------------------------------------------------------
     Animation
     ------------------------------------------------------------------------- */
  const clock = new THREE.Clock();
  let elapsed = 0;
  let revealed = false;

  function updateWaterAndClouds(dt) {
    windTime.value = elapsed;
    waterUniforms.uTime.value = elapsed;
    waterUniforms.uDay.value = lightState.day;
    waterUniforms.uGolden.value = lightState.golden;
    waterUniforms.uNight.value = lightState.night;
    fallMistSprites.forEach((s, i) => {
      const u = s.userData;
      s.position.x = u.baseX + Math.sin(elapsed * 0.7 + u.seed) * u.amp;
      s.position.z = u.baseZ + Math.cos(elapsed * 0.56 + u.seed * 1.3) * u.amp;
      s.position.y = (s.userData.baseY !== undefined ? s.userData.baseY : s.position.y) + Math.sin(elapsed * 0.8 + i) * 0.035;
      s.material.opacity = 0.045 + 0.04 * (0.5 + 0.5 * Math.sin(elapsed * 0.25 + u.seed * 2.0));
    });
    for (let ci = 0; ci < clouds.length; ci++) {
      const c = clouds[ci];
      const u = c.userData;
      const t = elapsed * (0.075 + u.speed * 2.6) + u.phase;
      c.position.x = u.baseX + Math.sin(t) * 0.68 + Math.sin(t * 0.57 + 1.1) * 0.1;
      c.position.z = u.baseZ + Math.cos(t * 0.78 + u.phase * 0.4) * 0.36;
      c.position.y = u.baseY + Math.sin(t * 0.93 + 1.2) * 0.17;
      c.rotation.y = Math.sin(t * 0.6) * 0.05;
      c.scale.setScalar(1 + Math.sin(t * 1.5 + 0.4) * 0.012);
      if (u.mainMat) {
        const nt = lightState.night;
        const warmR = 1.0 - nt * 0.48;
        const warmG = 0.93 + lightState.golden * 0.035 - nt * 0.42;
        const warmB = 0.84 + lightState.day * 0.07 - nt * 0.10;
        u.mainMat.color.setRGB(warmR, warmG, warmB);
        u.mainMat.opacity = u.mainBase * (1.0 - nt * 0.46) * (0.92 + lightState.golden * 0.10);
        u.wispMat.color.setRGB(1.0 - nt * 0.42, 0.95 - nt * 0.36, 0.9 + nt * 0.04);
        u.wispMat.opacity = u.wispBase * (1.0 - nt * 0.5) * (0.8 + 0.2 * Math.sin(t * 2.0 + 1.2));
        u.shineMat.opacity = (0.10 + lightState.golden * 0.1) * (1.0 - nt * 0.78) * (0.72 + 0.28 * Math.sin(t * 1.3));
        u.shineMat.color.setRGB(1.0, 0.78 + nt * 0.08, 0.52 + nt * 0.24);
        u.veilMat.opacity = (0.035 + lightState.golden * 0.055) * (1.0 - nt * 0.7);
        u.veilMat.color.setRGB(0.95, 0.74 + nt * 0.12, 0.52 + nt * 0.28);
        // the internal wisps drift independently for a feeling of volume
        u.main.scale.set(
          u.mainScaleX * (1 + Math.sin(t * 0.83 + 0.6) * 0.018),
          u.mainScaleY * (1 + Math.cos(t * 0.71 + 0.2) * 0.02),
          1
        );
        u.wisp.position.x = u.wispBaseX + Math.sin(t * 1.1 + 0.8) * 0.07;
        u.wisp.position.y = u.wispBaseY + Math.cos(t * 0.9 + 0.3) * 0.035;
        u.wisp.position.z = u.wispBaseZ + Math.sin(t * 0.7 + 2.1) * 0.03;
        u.shine.position.x = -u.width * 0.06 + Math.sin(t * 0.64) * 0.04;
      }
    }

    for (let i = 0; i < risingFallMist.length; i++) {
      const m = risingFallMist[i];
      const u = m.userData;
      const t = (elapsed * u.speed + u.phase) % 1;
      m.position.x = u.baseX + Math.sin(t * 6.4 + u.phase * 4.0) * u.drift;
      m.position.z = u.baseZ + Math.cos(t * 5.1 + u.phase * 3.0) * u.drift * 0.7;
      m.position.y = LAKE_LEVEL + 0.05 + t * u.rise;
      m.scale.set(u.scale * (0.45 + t * 1.6), u.scale * 0.55 * (0.4 + t * 1.2), 1);
      m.material.opacity = (0.06 + 0.1 * Math.sin(t * Math.PI)) * (1.0 - t * 0.4);
    }

    for (let i = 0; i < fallFoam.length; i++) {
      const s = fallFoam[i];
      const u = s.userData;
      const t = (elapsed * u.speed + u.phase) % 1;
      const e = t * t * (3 - 2 * t);
      s.position.set(
        RIVER_LEDGE.x + u.lateral + Math.sin(t * Math.PI) * u.sway,
        lerp(u.topY, LAKE_LEVEL + 0.03, e),
        lerp(u.topZ, u.bottomZ, e)
      );
      const stretch = 0.35 + Math.sin(t * Math.PI) * 0.65;
      s.scale.set(u.size * (0.6 + stretch * 0.4), u.size * (0.8 + stretch), 1);
      s.material.opacity = (0.22 + lightState.day * 0.1) * Math.sin(t * Math.PI);
      s.material.rotation = Math.sin(elapsed * 1.3 + u.phase * 5) * 0.12;
    }

    // atmospheric shafts
    for (let i = 0; i < shafts.length; i++) {
      const shaft = shafts[i];
      const u = shaftUniformsList[i];
      shaft.quaternion.copy(camera.quaternion);
      shaft.rotateZ(shaft.userData.roll);
      u.uTime.value = elapsed;
      const shaftBase = shaft.userData.base * (0.55 + lightState.golden * 0.8 + lightState.day * 0.25 + lightState.night * 0.15);
      u.uOpacity.value = shaftBase * (0.84 + 0.16 * Math.sin(elapsed * 0.11 + i * 1.4));
      if (lightState.night > 0.5) {
        u.uColor.value.setRGB(0.38, 0.55, 0.86);
      } else {
        u.uColor.value.setRGB(1.0, 0.74 - lightState.day * 0.04, 0.48 + lightState.day * 0.14);
      }
    }

    // valley mist: drift, breathe and take on the hour's colour
    for (let i = 0; i < mistSprites.length; i++) {
      const s = mistSprites[i];
      const u = s.userData;
      s.position.x = u.baseX + Math.sin(elapsed * u.speed + u.seed) * u.amp;
      s.position.z = u.baseZ + Math.cos(elapsed * u.speed * 0.77 + u.seed * 1.2) * u.amp * 0.8;
      s.position.y = u.baseY + Math.sin(elapsed * u.speed * 0.55 + u.seed * 2.0) * 0.045;
      const breathe = 0.75 + 0.25 * Math.sin(elapsed * 0.16 + u.seed * 2.7);
      s.material.opacity = u.baseOpacity * breathe * (0.8 + lightState.night * 0.45 + lightState.golden * 0.2);
      if (lightState.night > 0.5) {
        s.material.color.setRGB(0.46, 0.57, 0.70);
      } else {
        s.material.color.setRGB(0.92, 0.9, 0.84);
      }
    }

    // dust motes
    const moteData = motes.userData;
    const motePos = motes.geometry.getAttribute('position');
    for (let i = 0; i < moteData.base.length; i++) {
      const b = moteData.base[i];
      motePos.setXYZ(i,
        b.x + Math.sin(elapsed * b.speed + b.phase) * b.amp,
        b.y + Math.sin(elapsed * b.speed * 0.6 + b.phase * 1.7) * b.amp * 0.45,
        b.z + Math.cos(elapsed * b.speed * 0.72 + b.phase) * b.amp
      );
    }
    motePos.needsUpdate = true;
    motes.material.opacity = 0.25 + lightState.golden * 0.25 + lightState.day * 0.08;
    motes.material.color.setRGB(1.0, 0.83 + lightState.day * 0.05, 0.64 + lightState.day * 0.12);

    // fireflies
    const ffData = fireflies.userData;
    const ffPos = fireflies.geometry.getAttribute('position');
    for (let i = 0; i < ffData.seeds.length; i++) {
      const b = ffData.seeds[i];
      ffPos.setXYZ(i,
        b.x + Math.sin(elapsed * b.speed + b.phase) * b.amp,
        b.baseY + Math.cos(elapsed * b.speed * 0.73 + b.phase * 1.4) * b.amp * 0.55,
        b.z + Math.cos(elapsed * b.speed * 0.61 + b.phase) * b.amp * 0.8
      );
    }
    ffPos.needsUpdate = true;
    fireflies.material.opacity = lightState.night * 0.95 + lightState.golden * 0.04;
    fireflies.material.size = 0.13 + lightState.night * 0.075;

    for (const mat of glowingMushroomMats) {
      mat.emissiveIntensity = 0.08 + lightState.night * 1.35;
    }
    snowSparkles.material.opacity = 0.32 + lightState.golden * 0.22 + lightState.night * 0.2;
    snowSparkles.material.size = 0.03 + lightState.night * 0.016;
    for (let i = 0; i < lakeGlints.length; i++) {
      const glint = lakeGlints[i];
      glint.material.opacity = (0.10 + lightState.golden * 0.13 + lightState.day * 0.04) * (1.0 - lightState.night * 0.25);
      glint.material.color.setRGB(
        1.0,
        0.86 - lightState.night * 0.08,
        0.64 + lightState.night * 0.15
      );
      glint.position.x = LAKE.x - 0.12 + i * 0.22 + Math.sin(elapsed * 0.08 + i) * 0.06;
      glint.position.z = LAKE.z + 0.05 + Math.cos(elapsed * 0.07 + i) * 0.04;
    }

    const flowData = riverFlow.userData;
    const flowPos = riverFlow.geometry.getAttribute('position');
    for (let i = 0; i < flowData.seeds.length; i++) {
      const sd = flowData.seeds[i];
      const t = (sd.t + elapsed * sd.speed) % 1;
      const p = riverCurve.getPointAt(t);
      const tan = riverCurve.getTangentAt(t);
      const nx = -tan.z, nz = tan.x;
      const lateral = sd.lateral * (0.6 + Math.sin(t * 17.0 + sd.phase) * 0.35);
      const x = p.x + nx * lateral;
      const z = p.z + nz * lateral;
      flowPos.setXYZ(i,
        x,
        heightAt(p.x, p.z) + 0.075 + Math.sin(elapsed * 2.7 + sd.phase) * 0.006,
        z
      );
    }
    flowPos.needsUpdate = true;
    riverFlow.material.opacity = 0.4 + lightState.day * 0.2 + lightState.golden * 0.12;

    const splash = splashPoints.userData;
    const splashPos = splashPoints.geometry.getAttribute('position');
    for (let i = 0; i < splash.seeds.length; i++) {
      const sd = splash.seeds[i];
      const t = (elapsed * sd.speed + sd.phase) % 1;
      const spread = sd.radius * t;
      splashPos.setXYZ(i,
        RIVER_LEDGE.x + 0.08 + Math.cos(sd.angle) * spread,
        LAKE_LEVEL + 0.05 + Math.sin(t * Math.PI) * sd.lift - t * 0.10,
        splash.baseZ + Math.sin(sd.angle) * spread * 0.7
      );
    }
    splashPos.needsUpdate = true;
    splashPoints.material.opacity = 0.32 + lightState.day * 0.18 + lightState.golden * 0.12;
    updateInhabitants(dt);

    for (let i = 0; i < petalSprites.length; i++) {
      const p = petalSprites[i];
      const u = p.userData;
      p.position.y -= dt * u.fall;
      if (p.position.y < 0.55) {
        p.position.y = 8.1 + randRange(-.3, .3);
        p.position.x = randRange(-4.1, 4.1);
        p.position.z = randRange(-4.1, 4.1);
      }
      p.position.x += Math.sin(elapsed * 0.25 + u.phase) * u.drift * dt;
      p.position.z += Math.cos(elapsed * 0.21 + u.phase * 1.3) * u.drift * dt;
      p.material.rotation += u.spin * dt;
      p.material.opacity = u.baseOpacity * (0.65 + lightState.day * 0.25 + lightState.golden * 0.1);
    }

    for (let i = 0; i < baseClouds.length; i++) {
      const cloud = baseClouds[i];
      const u = cloud.userData;
      cloud.position.x = u.baseX + Math.sin(elapsed * 0.09 + i * 1.7) * 0.32;
      cloud.position.z = u.baseZ + Math.cos(elapsed * 0.075 + i * 2.1) * 0.2;
      cloud.material.opacity = u.baseOp * (0.78 + 0.22 * Math.sin(elapsed * 0.12 + i * 2.0)) * (0.8 + lightState.night * 0.35);
      if (lightState.night > 0.45) {
        cloud.material.color.setRGB(0.52, 0.63, 0.78);
      } else {
        cloud.material.color.setRGB(0.86, 0.91, 0.9);
      }
    }
    for (let i = 0; i < floatingIslets.length; i++) {
      const isl = floatingIslets[i];
      const u = isl.userData;
      isl.position.y = u.baseY + Math.sin(elapsed * 0.55 + u.phase) * 0.11;
      isl.position.x = u.baseX + Math.sin(elapsed * 0.36 + u.phase) * 0.09;
      isl.rotation.y = Math.sin(elapsed * 0.3 + u.phase) * 0.24;
    }
    for (const glint of cornerGlints) {
      glint.material.opacity = glint.userData.baseOpacity * (0.72 + 0.28 * Math.sin(elapsed * 0.3 + glint.userData.phase)) * (0.8 + lightState.night * 0.4);
    }

    glassMat.uniforms.uTime.value = elapsed;
    glassMat.uniforms.uWarmth.value = lightState.warmth;
    glassMat.uniforms.uNight.value = lightState.night;
    finalMat.uniforms.uWarmth.value = lightState.warmth;
    finalMat.uniforms.uNight.value = lightState.night;
    edgeMatCore.color.setRGB(
      1.25 + lightState.golden * 0.24,
      1.54 + lightState.golden * 0.10,
      1.78 - lightState.golden * 0.20 + lightState.night * 0.06
    );
    edgeMatCore.opacity = 0.42 - lightState.night * 0.16 + lightState.golden * 0.06;
    edgeMatGlow.color.setRGB(
      0.27 + lightState.golden * 0.10,
      0.43 + lightState.golden * 0.02,
      0.53 - lightState.golden * 0.08 + lightState.night * 0.12
    );
    edgeMatGlow.opacity = 0.10 + lightState.golden * 0.035;
    edgeMatWarm.opacity = 0.03 + lightState.golden * 0.085;
    sunGlowMat.opacity = 0.025 + lightState.golden * 0.035;
    sunHaloMat.opacity = 0.045 + lightState.golden * 0.055;
    sunStreakMat.opacity = (0.055 + lightState.golden * 0.065) * (1.0 - lightState.night * 0.7);
    sunStreakMat.color.setRGB(1.0, 0.84 + lightState.night * 0.03, 0.65 + lightState.night * 0.18);
    sunHaloMat.color.setRGB(1.0, 0.9 - lightState.night * 0.12, 0.74 + lightState.night * 0.2);
    sunGlowMat.color.setRGB(1.0, 0.82 - lightState.day * 0.04 - lightState.night * 0.02, 0.62 + lightState.night * 0.12);
    sunCoreMat.opacity = 0.16 + lightState.golden * 0.2;
    sunCoreMat.color.setRGB(1.0, 0.9 - lightState.night * 0.06, 0.7 + lightState.night * 0.15);
    bgMat.uniforms.uTime.value = elapsed;
    finalMat.uniforms.uTime.value = elapsed;
  }

  function angleLerp(current, target, rate, dt) {
    let diff = ((target - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return current + diff * (1 - Math.exp(-rate * dt));
  }

  function updateInhabitants(dt) {
    // Deer: one wanders slowly around the shore, one grazes and listens.
    for (const rig of animalRigs) {
      const obj = rig.obj;
      if (!obj || !obj.parent) continue;
      const u = obj.userData;
      if (rig.type === 'deerWalk') {
        u.pathAngle += dt * u.walkSpeed * (0.82 + 0.18 * Math.sin(elapsed * 0.23 + rig.phase));
        const a = u.pathAngle;
        const x = u.path.cx + Math.cos(a) * u.path.rx;
        const z = u.path.cz + Math.sin(a) * u.path.rz;
        const ground = heightAt(x, z);
        const dx = -Math.sin(a) * u.path.rx;
        const dz = Math.cos(a) * u.path.rz;
        const yaw = Math.atan2(-dz, dx);
        obj.rotation.y = angleLerp(obj.rotation.y, yaw, 2.5, dt);
        const step = elapsed * u.stepFreq + rig.phase;
        obj.position.set(x, ground + 0.012 + Math.abs(Math.sin(step)) * 0.011, z);
        const offsets = [0, Math.PI, Math.PI, 0];
        for (let l = 0; l < u.legs.length; l++) {
          u.legs[l].rotation.z = Math.sin(step + offsets[l]) * 0.31;
        }
        u.neck.rotation.z = -0.11 + Math.sin(step * 0.5 + rig.phase) * 0.035 - Math.max(0, Math.sin(elapsed * 0.19 + rig.phase)) * 0.17;
        u.neck.rotation.x = Math.sin(elapsed * 0.35 + rig.phase) * 0.025;
        if (u.tail) {
          u.tail.rotation.y = Math.sin(elapsed * 2.1 + rig.phase) * 0.35;
          u.tail.rotation.z = Math.sin(elapsed * 1.7 + rig.phase) * 0.08;
        }
        if (u.ears) {
          for (let e = 0; e < u.ears.length; e++) {
            u.ears[e].rotation.z = u.earBase[e] + Math.sin(elapsed * 3.0 + rig.phase + e * 0.5) * 0.045;
          }
        }
      } else if (rig.type === 'deerGraze') {
        const cycle = Math.sin(elapsed * 0.27 + rig.phase);
        const dip = -0.2 - (cycle * 0.5 + 0.5) * 0.34;
        u.neck.rotation.z = angleLerp(u.neck.rotation.z, dip, 2.0, dt);
        u.neck.rotation.x = Math.sin(elapsed * 0.41 + rig.phase) * 0.04;
        obj.position.y = u.baseGround + 0.011 + Math.sin(elapsed * 1.1 + rig.phase) * 0.0025;
        if (u.tail) {
          u.tail.rotation.y = Math.sin(elapsed * 2.5 + rig.phase) * 0.4;
          u.tail.rotation.z = Math.sin(elapsed * 1.9 + rig.phase) * 0.1;
        }
        if (u.ears) {
          for (let e = 0; e < u.ears.length; e++) {
            u.ears[e].rotation.z = u.earBase[e] + Math.sin(elapsed * (2.2 + e * 0.4) + rig.phase) * 0.05;
          }
        }
      } else if (rig.type === 'rabbit') {
        const hopPhase = elapsed * 3.8 + u.phase;
        const hop = Math.max(0, Math.sin(hopPhase));
        rig.angle += dt * 0.32 * smoothstep(0.15, 0.85, hop);
        const x = u.baseX + Math.cos(rig.angle) * 0.15;
        const z = u.baseZ + Math.sin(rig.angle * 0.8 + 0.4) * 0.12;
        const ground = heightAt(x, z);
        obj.position.set(x, ground + 0.012 + Math.pow(hop, 1.7) * 0.065, z);
        const vx = -Math.sin(rig.angle) * 0.15;
        const vz = Math.cos(rig.angle * 0.8 + 0.4) * 0.12 * 0.8;
        obj.rotation.y = angleLerp(obj.rotation.y, Math.atan2(-vz, vx), 2.0, dt);
        obj.rotation.z = Math.sin(hopPhase) * 0.06;
        if (u.ears) {
          u.ears[0].rotation.z = -0.18 + Math.sin(elapsed * 3.4 + u.phase) * 0.13 + hop * 0.1;
          u.ears[1].rotation.z = 0.02 - Math.sin(elapsed * 3.4 + u.phase + .4) * 0.13 - hop * 0.1;
        }
      }
    }

    // Birds circle the mountain with visible wingbeats.
    for (let i = 0; i < birds.length; i++) {
      const bird = birds[i];
      const angle = elapsed * bird.speed + bird.phase;
      const x = bird.centerX + Math.cos(angle) * bird.radius;
      const z = bird.centerZ + Math.sin(angle) * bird.radius;
      const y = bird.height + Math.sin(angle * 2.0 + bird.phase) * 0.24;
      bird.mesh.position.set(x, y, z);
      const vx = -Math.sin(angle) * bird.radius * Math.sign(bird.speed);
      const vz = Math.cos(angle) * bird.radius * Math.sign(bird.speed);
      bird.mesh.rotation.y = angleLerp(bird.mesh.rotation.y, Math.atan2(-vz, vx), 4.0, dt);
      bird.mesh.rotation.z = Math.sin(angle * 2.0 + bird.phase) * 0.18;
      bird.mesh.rotation.x = Math.sin(angle * 3.0 + bird.phase) * 0.06;
      const flap = Math.sin(elapsed * bird.wingSpeed + bird.phase) * 0.92;
      bird.mesh.userData.wings[0].rotation.x = flap;
      bird.mesh.userData.wings[1].rotation.x = -flap;
    }

    // Koi: quicker, with a soft tail swish.
    for (let i = 0; i < koi.length; i++) {
      const fish = koi[i];
      const u = fish.userData;
      const a = elapsed * u.speed + u.phase;
      fish.position.x = u.cx + Math.cos(a) * u.radiusX;
      fish.position.z = u.cz + Math.sin(a) * u.radiusZ;
      fish.rotation.y = -a + Math.PI * 0.5;
      fish.position.y = LAKE_LEVEL - 0.058 + Math.sin(a * 2.1) * 0.008;
      if (u.tail) {
        u.tail.rotation.y = Math.sin(elapsed * 7.5 + u.swimPhase) * 0.3;
        u.tail.rotation.z = Math.sin(elapsed * 6.0 + u.swimPhase) * 0.12;
      }
      fish.rotation.z = Math.sin(a * 2.0) * 0.06;
    }

    // Butterflies drift in lazy figure-eights, wings beating quickly.
    for (let i = 0; i < butterflies.length; i++) {
      const b = butterflies[i];
      const a = elapsed * b.speed + b.phase;
      const x = b.cx + Math.cos(a) * b.radiusX + Math.sin(a * 1.7) * 0.08;
      const z = b.cz + Math.sin(a * 0.9) * b.radiusZ;
      const y = b.height + Math.sin(a * 2.3) * 0.16 + Math.sin(elapsed * 1.1 + b.phase) * 0.03;
      b.mesh.position.set(x, y, z);
      const vx = -Math.sin(a) * b.radiusX;
      const vz = Math.cos(a * 0.9) * b.radiusZ * 0.9;
      b.mesh.rotation.y = angleLerp(b.mesh.rotation.y, Math.atan2(-vz, vx), 3.0, dt);
      const flap = Math.sin(elapsed * b.wingSpeed + b.phase);
      b.wings[0].rotation.x = flap * 0.95 + 0.15;
      b.wings[1].rotation.x = -flap * 0.95 - 0.15;
      b.mesh.rotation.z = Math.sin(elapsed * 2.1 + b.phase) * 0.12;
    }

    for (let i = 0; i < lilyPads.length; i++) {
      const p = lilyPads[i];
      p.position.y = LAKE_LEVEL + 0.008 + i * 0.0004 + Math.sin(elapsed * 0.9 + i) * 0.004;
      p.rotation.z += dt * 0.035 * (i % 2 ? 1 : -1);
    }
    for (let i = 0; i < floatingPetals.length; i++) {
      const p = floatingPetals[i];
      p.position.x = p.userData.baseX + Math.sin(elapsed * 0.12 + p.userData.phase) * 0.035;
      p.position.z = p.userData.baseZ + Math.cos(elapsed * 0.1 + p.userData.phase) * 0.025;
      p.position.y = LAKE_LEVEL + 0.018 + Math.sin(elapsed * 0.8 + i) * 0.002;
      p.rotation.z += dt * 0.05 * (i % 2 ? 1 : -1);
    }
  }

  function render() {
    // 1. backdrop
    renderer.setRenderTarget(sceneRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(bgScene, bgCamera);

    // 2. scene (depth cleared, colour preserved)
    renderer.clearDepth();
    renderer.render(scene, camera);

    // 3. half-res blur chain (for the tilt-shift)
    blurMat.uniforms.tDiffuse.value = sceneRT.texture;
    blurMat.uniforms.uDirection.value.set(1, 0);
    blurMat.uniforms.uTexel.value.set(1 / (sizeW * 0.5), 1 / (sizeH * 0.5));
    blurMat.uniforms.uRadius.value = 1.45;
    renderPass(blurMat, blurA);

    blurMat.uniforms.tDiffuse.value = blurA.texture;
    blurMat.uniforms.uDirection.value.set(0, 1);
    blurMat.uniforms.uRadius.value = 1.45;
    renderPass(blurMat, blurB);

    blurMat.uniforms.tDiffuse.value = blurB.texture;
    blurMat.uniforms.uDirection.value.set(1, 0);
    blurMat.uniforms.uRadius.value = 2.4;
    renderPass(blurMat, blurA);

    blurMat.uniforms.tDiffuse.value = blurA.texture;
    blurMat.uniforms.uDirection.value.set(0, 1);
    blurMat.uniforms.uRadius.value = 2.4;
    renderPass(blurMat, blurB);

    // 4. bloom chain
    brightMat.uniforms.tDiffuse.value = sceneRT.texture;
    renderPass(brightMat, bloomA);

    blurMat.uniforms.tDiffuse.value = bloomA.texture;
    blurMat.uniforms.uDirection.value.set(1, 0);
    blurMat.uniforms.uTexel.value.set(1 / (sizeW * 0.25), 1 / (sizeH * 0.25));
    blurMat.uniforms.uRadius.value = 2.0;
    renderPass(blurMat, bloomB);

    blurMat.uniforms.tDiffuse.value = bloomB.texture;
    blurMat.uniforms.uDirection.value.set(0, 1);
    blurMat.uniforms.uRadius.value = 2.6;
    renderPass(blurMat, bloomA);

    // 5. final composite to screen
    finalMat.uniforms.tScene.value = sceneRT.texture;
    finalMat.uniforms.tBlur.value = blurB.texture;
    finalMat.uniforms.tBloom.value = bloomA.texture;
    quadMesh.material = finalMat;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.clear(true, true, false);
    renderer.render(quadScene, quadCamera);

    if (!revealed) {
      revealed = true;
      setTimeout(() => {
        document.body.classList.add('ready');
        setTimeout(() => {
          const loader = document.getElementById('loader');
          if (loader) loader.remove();
        }, 650);
      }, 350);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    if (autoTime) {
      timeOfDay = (timeOfDay + dt / DAY_PERIOD) % 1;
    }
    updateEnvironmentLighting(timeOfDay);
    updateCamera(dt, elapsed);
    updateWaterAndClouds(dt);
    const zoomIn = clamp((cam.fitRadius - cam.radius) / Math.max(1, cam.fitRadius), 0, 0.35);
    finalMat.uniforms.uBlurAmount.value = lerp(0.92, 0.44, smoothstep(0, 0.22, zoomIn));
    uiAccum += dt;
    if (uiAccum > 0.14) {
      updateTimeUI(false);
      uiAccum = 0;
    }

    render();
  }

  // small initial catch-up so the first rendered frame already has a nice state
  updateEnvironmentLighting(timeOfDay);
  updateCamera(0.016, 0);
  updateWaterAndClouds(0);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clock.getDelta();
  });
  animate();
})();
