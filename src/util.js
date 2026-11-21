import * as THREE from '../vendor/three.module.js';

/* ------------------------------------------------------------------ math */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = mulberry32(1337);
export const rr = (a, b) => a + rnd() * (b - a);
export const pick = (arr) => arr[(rnd() * arr.length) | 0];

function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f) * amp; amp *= 0.5; f *= 2.03; }
  return s;
}

/* --------------------------------------------------------------- textures */
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (opts.repeat) t.repeat.set(opts.repeat, opts.repeat);
  return t;
}

export function grassTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(9);
    // thin blades, varied greens, dark at the base -> reads as dense turf
    for (let i = 0; i < 210; i++) {
      const x0 = 4 + r() * (w - 8);
      const hgt = h * (0.30 + r() * 0.66);
      const lean = (r() - 0.5) * 34;
      const wid = 0.7 + r() * 1.3;
      const g1 = g.createLinearGradient(0, h, 0, h - hgt);
      const dark = 26 + r() * 18, mid = 74 + r() * 44, tip = 108 + r() * 62;
      const warmth = 0.10 + r() * 0.42; // mostly green, a few sun-bleached blades
      g1.addColorStop(0, `rgba(${(dark * 0.7) | 0},${dark | 0},${(dark * 0.5) | 0},0.92)`);
      g1.addColorStop(0.62, `rgba(${(tip * (0.62 + warmth * 0.34)) | 0},${tip | 0},${(tip * (0.34 + (1 - warmth) * 0.42)) | 0},0.97)`);
      g1.addColorStop(1, `rgba(${(mid * (0.62 + warmth * 0.4)) | 0},${(mid * 1.06) | 0},${(mid * 0.36) | 0},1)`);
      g.strokeStyle = g1; g.lineWidth = wid; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, h);
      g.quadraticCurveTo(x0 + lean * 0.4, h - hgt * 0.6, x0 + lean, h - hgt);
      g.stroke();
    }
    // a few broader weed leaves + tiny seed heads for silhouette variety
    for (let i = 0; i < 7; i++) {
      const x0 = 10 + r() * (w - 20), hgt = h * (0.4 + r() * 0.35);
      const v = 70 + r() * 50;
      g.fillStyle = `rgba(${(v * 0.56) | 0},${v | 0},${(v * 0.36) | 0},0.95)`;
      g.beginPath();
      g.moveTo(x0, h);
      g.quadraticCurveTo(x0 - 9 + r() * 18, h - hgt * 0.7, x0 + (r() - 0.5) * 26, h - hgt);
      g.quadraticCurveTo(x0 + 4, h - hgt * 0.55, x0, h);
      g.fill();
    }
  }, { clamp: true });
}

export function fernTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(23);
    const cx = w / 2, cy = h - 6;
    for (let f = 0; f < 9; f++) {
      const ang = -Math.PI / 2 + (f - 4) * 0.30 + (r() - 0.5) * 0.14;
      const len = h * (0.55 + r() * 0.42);
      const seg = 16;
      for (let s = 1; s <= seg; s++) {
        const t = s / seg;
        const x = cx + Math.cos(ang) * len * t + Math.sin(t * 3) * 6 * t;
        const y = cy + Math.sin(ang) * len * t + t * t * 26;
        const leaf = (1 - t) * 15 + 3;
        for (const side of [-1, 1]) {
          const la = ang + side * 1.25;
          const v = 50 + r() * 60;
          g.fillStyle = `rgba(${(v * 0.5) | 0},${(v * 1.15) | 0},${(v * 0.55) | 0},${0.75 + r() * 0.25})`;
          g.beginPath();
          g.ellipse(x, y, leaf * 0.42, leaf, la, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.strokeStyle = 'rgba(52,78,36,0.9)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(cx, cy);
      for (let s = 1; s <= seg; s++) {
        const t = s / seg;
        g.lineTo(cx + Math.cos(ang) * len * t + Math.sin(t * 3) * 6 * t,
                 cy + Math.sin(ang) * len * t + t * t * 26);
      }
      g.stroke();
    }
  }, { clamp: true });
}

export function leafCardTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(41);

    // back layer: darker, slightly larger -> gives the card internal depth
    for (let pass = 0; pass < 2; pass++) {
      const back = pass === 0;
      const count = back ? 60 : 120;
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2;
        const rad = Math.sqrt(r()) * (back ? 0.30 : 0.47) * w;
        const x = w * 0.5 + Math.cos(a) * rad;
        const y = h * 0.5 + Math.sin(a) * rad * 0.92;
        const rx = (back ? 16 : 10) + r() * (back ? 20 : 14);
        const ry = rx * (0.42 + r() * 0.34);
        const ang = r() * Math.PI * 2;
        const v = back ? 34 + r() * 26 : 62 + r() * 62;
        const warmth = r() * 0.42;
        g.save(); g.translate(x, y); g.rotate(ang);
        const grd = g.createLinearGradient(-rx, 0, rx, 0);
        grd.addColorStop(0, `rgba(${(v * (0.36 + warmth * 0.3)) | 0},${v | 0},${(v * 0.30) | 0},${back ? 0.86 : 0.97})`);
        grd.addColorStop(1, `rgba(${(v * (0.86 + warmth * 0.5)) | 0},${(v * 1.16) | 0},${(v * (0.42 + warmth * 0.3)) | 0},${back ? 0.9 : 0.99})`);
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(-rx, 0);
        g.quadraticCurveTo(0, -ry, rx, 0);
        g.quadraticCurveTo(0, ry, -rx, 0);
        g.fill();
        // midrib + vein hint
        g.strokeStyle = `rgba(${(v * 0.5) | 0},${(v * 0.95) | 0},${(v * 0.34) | 0},0.5)`;
        g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(-rx * 0.95, 0); g.lineTo(rx * 0.95, 0); g.stroke();
        g.restore();
      }
    }
    // a handful of dry / yellowed leaves for age
    for (let i = 0; i < 14; i++) {
      const x = r() * w, y = r() * h;
      const rx = 11 + r() * 15, ry = rx * (0.4 + r() * 0.3);
      g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
      g.fillStyle = `rgba(${(120 + r() * 60) | 0},${(96 + r() * 40) | 0},${(40 + r() * 26) | 0},0.9)`;
      g.beginPath();
      g.moveTo(-rx, 0);
      g.quadraticCurveTo(0, -ry, rx, 0);
      g.quadraticCurveTo(0, ry, -rx, 0);
      g.fill();
      g.restore();
    }
  }, { clamp: true });
}

export function palmFrondTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(131);
    const cx = w / 2;
    // rachis
    g.strokeStyle = 'rgba(96,104,52,0.95)';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, h); g.lineTo(cx, h * 0.05); g.stroke();
    // leaflets, longer mid-frond, shorter at the tip, drooping outward
    const n = 46;
    for (let i = 0; i < n; i++) {
      const t = i / n;                     // 0 = base, 1 = tip
      const y = h - t * h * 0.95;
      const len = (0.16 + Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92) * 0.84) * (w * 0.46);
      const v = 66 + r() * 62 - t * 14;
      const warm = r() * 0.3;
      for (const side of [-1, 1]) {
        g.strokeStyle = `rgba(${(v * (0.6 + warm * 0.5)) | 0},${v | 0},${(v * (0.34 + (1 - warm) * 0.36)) | 0},0.97)`;
        g.lineWidth = 1.6 + r() * 2.2;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx, y);
        g.quadraticCurveTo(cx + side * len * 0.55, y - 2, cx + side * len, y + len * 0.28 + 2);
        g.stroke();
      }
    }
    // torn / browned tips
    for (let i = 0; i < 18; i++) {
      const t = r();
      const y = h - t * h;
      const side = r() > 0.5 ? 1 : -1;
      g.strokeStyle = `rgba(${(120 + r() * 50) | 0},${(96 + r() * 30) | 0},${(44 + r() * 20) | 0},0.75)`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(cx + side * w * 0.2, y);
      g.lineTo(cx + side * w * 0.42, y + r() * 10);
      g.stroke();
    }
  }, { clamp: true });
}

export function wildflowerTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(613);
    // stems first, then heads: reads as a clump of small wildflowers
    for (let i = 0; i < 26; i++) {
      const x0 = 12 + r() * (w - 24);
      const hgt = h * (0.42 + r() * 0.5);
      const lean = (r() - 0.5) * 26;
      const tone = 52 + r() * 34;
      g.strokeStyle = `rgba(${(tone * 0.72) | 0},${tone | 0},${(tone * 0.5) | 0},0.92)`;
      g.lineWidth = 1.1 + r() * 1.3;
      g.beginPath();
      g.moveTo(x0, h);
      g.quadraticCurveTo(x0 + lean * 0.5, h - hgt * 0.55, x0 + lean, h - hgt);
      g.stroke();

      // a pair of small leaves on the stem
      for (let k = 1; k <= 2; k++) {
        const t = 0.35 + k * 0.22;
        const lx = x0 + lean * t, ly = h - hgt * t;
        g.fillStyle = `rgba(${(tone * 0.6) | 0},${(tone * 1.05) | 0},${(tone * 0.44) | 0},0.9)`;
        g.beginPath();
        g.ellipse(lx + (k === 1 ? -4 : 4), ly, 4.2, 1.9, k === 1 ? -0.5 : 0.5, 0, Math.PI * 2);
        g.fill();
      }

      // flower head: a few petals around a bright core
      const hx = x0 + lean, hy = h - hgt;
      const kind = r();
      const petal = kind < 0.55 ? [232, 206, 96]      // buttercup yellow
        : kind < 0.82 ? [238, 236, 222]               // small white
          : [172, 150, 216];                          // violet
      const rad = 2.6 + r() * 2.4;
      for (let pnum = 0; pnum < 5; pnum++) {
        const ang = (pnum / 5) * Math.PI * 2 + r() * 0.4;
        g.fillStyle = `rgba(${petal[0]},${petal[1]},${petal[2]},${0.88 + r() * 0.12})`;
        g.beginPath();
        g.ellipse(hx + Math.cos(ang) * rad * 0.72, hy + Math.sin(ang) * rad * 0.72,
          rad * 0.62, rad * 0.5, ang, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(196,150,44,0.95)';
      g.beginPath(); g.arc(hx, hy, rad * 0.48, 0, Math.PI * 2); g.fill();
    }
  }, { clamp: true });
}

export function vineTexture() {
  return canvasTex(128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(97);
    for (let s = 0; s < 6; s++) {
      const x0 = 14 + s * 20 + r() * 8;
      let x = x0;
      g.strokeStyle = 'rgba(58,72,38,0.95)'; g.lineWidth = 1.6 + r();
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y < h; y += 10) {
        x += Math.sin(y * 0.05 + s) * 2.2;
        g.lineTo(x, y);
      }
      g.stroke();
      for (let y = 12; y < h; y += 16 + r() * 22) {
        const xx = x0 + Math.sin(y * 0.05 + s) * -2.2;
        const v = 55 + r() * 55;
        g.fillStyle = `rgba(${(v * 0.45) | 0},${(v * 1.05) | 0},${(v * 0.42) | 0},0.92)`;
        g.beginPath();
        g.ellipse(xx + (r() - 0.5) * 12, y, 5 + r() * 5, 3 + r() * 4, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, { clamp: true });
}

export function stoneTexture(repeat = 1) {
  return canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(5);
    g.fillStyle = '#8b8578'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 90 + r() * 90;
      g.fillStyle = `rgba(${v | 0},${(v * 0.97) | 0},${(v * 0.88) | 0},${0.05 + r() * 0.14})`;
      const s = 1 + r() * 4;
      g.fillRect(r() * w, r() * h, s, s);
    }
    g.strokeStyle = 'rgba(60,56,50,0.45)';
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 0.6 + r() * 1.4;
      g.beginPath();
      let x = r() * w, y = r() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const v = 70 + r() * 40;
      g.fillStyle = `rgba(${(v * 0.7) | 0},${(v * 1.1) | 0},${(v * 0.6) | 0},${0.05 + r() * 0.1})`;
      g.beginPath(); g.arc(r() * w, r() * h, 8 + r() * 34, 0, Math.PI * 2); g.fill();
    }
  }, { repeat });
}

export function woodTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = mulberry32(11);
    g.fillStyle = '#6b4f33'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const v = 60 + r() * 70;
      g.fillStyle = `rgba(${v | 0},${(v * 0.72) | 0},${(v * 0.45) | 0},0.35)`;
      g.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${30 + r() * 40 | 0},${20 + r() * 30 | 0},${12 + r() * 20 | 0},${0.1 + r() * 0.3})`;
      g.lineWidth = 0.7 + r() * 1.4;
      g.beginPath();
      const y = r() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 14, w * 0.7, y + (r() - 0.5) * 14, w, y + (r() - 0.5) * 8);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(40,28,18,0.5)';
      g.fillRect(0, i * 64, w, 3);
    }
  }, { repeat: 1 });
}

export function dustSprite() {
  return canvasTex(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,246,225,1)');
    grd.addColorStop(0.35, 'rgba(255,240,205,0.55)');
    grd.addColorStop(1, 'rgba(255,235,190,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { clamp: true });
}

export function flagTexture(colorA = '#8d2b22', colorB = '#c9a24a') {
  return canvasTex(256, 192, (g, w, h) => {
    const r = mulberry32(3);
    g.fillStyle = colorA;
    g.fillRect(0, 0, w, h);

    // dyed wool: uneven colour, sun-faded toward the free edge
    for (let i = 0; i < 2600; i++) {
      const v = (r() - 0.5) * 46;
      g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 240 : 0},${v > 0 ? 220 : 0},${Math.abs(v) / 900})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 8, 1 + r() * 3);
    }
    const fade = g.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(255,246,224,0.02)');
    fade.addColorStop(1, 'rgba(255,246,224,0.26)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);

    // heraldic bands
    g.fillStyle = colorB;
    g.fillRect(0, h * 0.36, w, h * 0.11);
    g.fillRect(0, h * 0.62, w, h * 0.055);
    // weathered band edges
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(${20 + r() * 40},${12 + r() * 30},${10 + r() * 20},${0.10 + r() * 0.28})`;
      const yy = (r() > 0.5 ? h * 0.36 : h * 0.62) + (r() - 0.5) * h * 0.05;
      g.fillRect(r() * w, yy, 2 + r() * 9, 1 + r() * 2);
    }

    // seam stitching along the hoist
    g.strokeStyle = 'rgba(232,220,190,0.30)';
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(w * 0.07, 0); g.lineTo(w * 0.07, h); g.stroke();
    g.setLineDash([]);

    // frayed holes and a ragged hem, cut in alpha
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 34; i++) {
      g.beginPath();
      g.arc(w * (0.25 + r() * 0.75), h * (0.2 + r() * 0.8), 1.5 + r() * 5, 0, Math.PI * 2);
      g.fill();
    }
    for (let x = 0; x < w; x += 2) {
      const depth = h * (0.03 + Math.abs(Math.sin(x * 0.19)) * 0.09 + r() * 0.05);
      g.fillRect(x, h - depth, 2.2, depth);
    }
    // torn free edge
    for (let y = 0; y < h; y += 2) {
      const depth = w * (0.01 + Math.abs(Math.cos(y * 0.13)) * 0.05 + r() * 0.03);
      g.fillRect(w - depth, y, depth, 2.2);
    }
    g.globalCompositeOperation = 'source-over';
  }, { clamp: true });
}

/* ---------------------------------------------------------- geometry kit */
export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.w = []; }
  add(geo, matrix, color, wind = 0, uvScale = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    const col = color instanceof THREE.Color ? color : new THREE.Color(color ?? 0xffffff);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      this.p.push(v.x, v.y, v.z);
      if (nor) { nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); this.n.push(nv.x, nv.y, nv.z); }
      else this.n.push(0, 1, 0);
      if (uv) this.u.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale);
      else this.u.push(0, 0);
      this.c.push(col.r, col.g, col.b);
      this.w.push(typeof wind === 'function' ? wind(v.y) : wind);
    }
    if (g !== geo) g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
};

/* ------------------------------------------------------------- wind shader */
export const timeUniform = { value: 0 };

export function windify(mat, amp = 0.14, freq = 1.4) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uAmp = { value: amp };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uAmp;\nattribute float aWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float phase = 0.0;
        #ifdef USE_INSTANCING
          phase = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.45;
        #endif
        float ww = aWind;
        float s1 = sin(uTime * ${freq.toFixed(2)} + phase) * uAmp * ww;
        float s2 = sin(uTime * ${(freq * 2.7).toFixed(2)} + phase * 1.7) * 0.32 * uAmp * ww;
        transformed.x += s1 + s2;
        transformed.z += cos(uTime * ${(freq * 0.8).toFixed(2)} + phase * 1.3) * uAmp * 0.7 * ww;
      }`);
  };
  mat.customProgramCacheKey = () => `wind_${amp}_${freq}`;
  return mat;
}

/* hanging cloth: ripples driven from the pole edge, with normals rebuilt
   analytically so folds actually catch the light instead of looking painted on */
export function clothify(mat, opts = {}) {
  const speed = (opts.speed ?? 2.6).toFixed(2);
  const amp = (opts.amp ?? 0.13).toFixed(3);
  const len = (opts.wavelength ?? 1.05).toFixed(3);
  const billow = (opts.billow ?? 0.55).toFixed(3);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vFold;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  // flag spans 0..W along x (pole at x = 0) and -H/2..H/2 along y
  float t = clamp(position.x, 0.0, 1.0);
  float phase = uTime * ${speed} + position.y * 0.55;
  float k = 6.2831 / ${len};
  float a = ${amp} * pow(t, 1.35);
  float d = a * k * cos(t * 6.2831 * 1.6 - phase);
  objectNormal = normalize(vec3(-d, 0.0, 1.0));
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float t = clamp(position.x, 0.0, 1.0);
  float phase = uTime * ${speed} + position.y * 0.55;
  float a = ${amp} * pow(t, 1.35);
  // travelling ripple across the cloth
  transformed.z += sin(t * 6.2831 * 1.6 - phase) * a;
  // the free edge lifts and drops as a whole
  transformed.y += sin(uTime * ${speed} * 0.55 + t * 2.4) * ${billow} * 0.12 * pow(t, 1.5);
  transformed.z += cos(uTime * ${speed} * 0.37) * 0.06 * pow(t, 2.0);
  vFold = t;
}`);
  };
  mat.customProgramCacheKey = () => `cloth_${speed}_${amp}_${len}_${billow}`;
  return mat;
}

/* moss creeping up from the ground, blended into any standard material */
export function mossify(mat, amount = 0.75) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uMoss = { value: amount };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uMoss;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float up = clamp(vNormal.y * 0.5 + 0.5, 0.0, 1.0);
        float upward = smoothstep(0.45, 0.95, up);
        float low = smoothstep(1.6, 0.0, vViewPosition.z);
        float n = fract(sin(dot(vViewPosition.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float mask = clamp(upward * 0.75 + low * 0.35 + n * 0.22 - 0.28, 0.0, 1.0) * uMoss;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.185, 0.075), mask * 0.85);
      }`);
  };
  return mat;
}

export function randPointInRing(rMin, rMax, seed = 1) {
  const r = mulberry32(seed);
  const a = r() * Math.PI * 2;
  const rad = Math.sqrt(r()) * (rMax - rMin) + rMin;
  return [Math.cos(a) * rad, Math.sin(a) * rad];
}

/* ================================================================== *
 *  PBR surface kit: height-based normal maps + chamfered geometry
 * ================================================================== */

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function texFrom(canvas, { srgb = true, repeat = 1, clamp = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/** Sobel height -> tangent-space normal map (linear space). */
export function normalFromCanvas(canvas, strength = 2.2) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const lum = (x, y) => {
    x = ((x % w) + w) % w; y = ((y % h) + h) % h;
    const i = (y * w + x) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };
  const out = makeCanvas(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
        const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
        let nx = -dx, ny = -dy, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * w + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  return texFrom(out, { srgb: false });
}

/* ---------------------------------------------------------- stone wall */
export function stoneSurface(repeat = 2) {
  const c = makeCanvas(512, 512, (g, w, h) => {
    const r = mulberry32(17);
    g.fillStyle = '#6d675c'; g.fillRect(0, 0, w, h);

    const rows = 4, rowH = h / rows;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? -rowH * 0.55 : 0;
      let x = offset;
      while (x < w) {
        const bw = rowH * (0.9 + r() * 1.5);
        const tone = 96 + r() * 58;
        const warm = r() * 16;
        g.fillStyle = `rgb(${(tone + warm) | 0},${(tone * 0.98) | 0},${(tone * 0.9) | 0})`;
        g.fillRect(x + 2, row * rowH + 2, bw - 4, rowH - 4);

        // block surface grain
        for (let i = 0; i < 220; i++) {
          const v = tone + (r() - 0.5) * 46;
          g.fillStyle = `rgba(${v | 0},${(v * 0.97) | 0},${(v * 0.9) | 0},${0.1 + r() * 0.3})`;
          g.fillRect(x + 3 + r() * (bw - 8), row * rowH + 3 + r() * (rowH - 8), 1 + r() * 4, 1 + r() * 3);
        }
        // pitting / chipped edges
        for (let i = 0; i < 5; i++) {
          g.fillStyle = `rgba(52,48,42,${0.25 + r() * 0.35})`;
          const px = x + 2 + r() * (bw - 6);
          const py = row * rowH + (r() > 0.5 ? 2 : rowH - 8) + r() * 4;
          g.beginPath();
          g.ellipse(px, py, 2 + r() * 7, 1.5 + r() * 4, r() * 3, 0, Math.PI * 2);
          g.fill();
        }
        // hairline cracks
        if (r() > 0.55) {
          g.strokeStyle = `rgba(40,37,32,${0.3 + r() * 0.35})`;
          g.lineWidth = 0.7 + r() * 1.1;
          g.beginPath();
          let cx = x + r() * bw, cy = row * rowH + r() * rowH;
          g.moveTo(cx, cy);
          for (let k = 0; k < 5; k++) {
            cx += (r() - 0.5) * 26; cy += (r() - 0.5) * 22;
            g.lineTo(cx, cy);
          }
          g.stroke();
        }
        x += bw;
      }
    }
    // mortar recess darkening
    g.fillStyle = 'rgba(34,31,27,0.5)';
    for (let row = 0; row <= rows; row++) g.fillRect(0, row * rowH - 2, w, 4);
    // damp / moss patches
    for (let i = 0; i < 46; i++) {
      const v = 40 + r() * 60;
      g.fillStyle = `rgba(${(v * 0.5) | 0},${v | 0},${(v * 0.42) | 0},${0.06 + r() * 0.2})`;
      g.beginPath();
      g.ellipse(r() * w, h - r() * h * 0.85, 12 + r() * 70, 8 + r() * 40, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // water streaks running down
    for (let i = 0; i < 24; i++) {
      const x0 = r() * w;
      g.fillStyle = `rgba(46,44,38,${0.05 + r() * 0.12})`;
      g.fillRect(x0, 0, 2 + r() * 9, h * (0.25 + r() * 0.75));
    }
  });
  return {
    map: texFrom(c, { repeat }),
    normal: normalFromCanvas(c, 2.6),
  };
}

/* ------------------------------------------------------------- fabric */
// a real tangent-space normal map derived from a woven twill weave
export function fabricNormal(repeat = 6, strength = 1.1) {
  const c = makeCanvas(256, 256, (g, w, h) => {
    const r = mulberry32(77);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    // warp and weft threads as a raised grid
    for (let i = 0; i < w; i += 4) {
      const v = 176 + (r() - 0.5) * 40;
      g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      g.fillRect(i, 0, 1.8, h);
      const v2 = 172 + (r() - 0.5) * 40;
      g.fillStyle = `rgb(${v2 | 0},${v2 | 0},${v2 | 0})`;
      g.fillRect(0, i + 2, w, 1.8);
    }
    // slubs and worn patches in the weave
    for (let i = 0; i < 420; i++) {
      const v = 128 + (r() - 0.5) * 80;
      g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.5)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 2);
    }
  });
  const t = normalFromCanvas(c, strength);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/* ------------------------------------------------------- plaster / stucco */
// old lime render: faded paint, peeled patches exposing brickwork, hairline
// cracks and rain streaks — what makes a colonial wall read as derelict
export function plasterSurface(repeat = 1, tint = [222, 214, 192]) {
  const c = makeCanvas(512, 512, (g, w, h) => {
    const r = mulberry32(91);
    const [tr, tg, tb] = tint;

    // brick substrate (only shows through the peeled areas)
    g.fillStyle = '#6a4034';
    g.fillRect(0, 0, w, h);
    const rowH = h / 16;
    for (let row = 0; row < 16; row++) {
      let x = row % 2 ? -rowH * 0.9 : 0;
      while (x < w) {
        const bw = rowH * (1.5 + r() * 0.9);
        const t2 = 0.72 + r() * 0.42;
        g.fillStyle = `rgb(${(126 * t2) | 0},${(76 * t2) | 0},${(60 * t2) | 0})`;
        g.fillRect(x + 1.5, row * rowH + 1.5, bw - 3, rowH - 3);
        for (let i = 0; i < 26; i++) {
          const v = 0.7 + r() * 0.5;
          g.fillStyle = `rgba(${(132 * v) | 0},${(82 * v) | 0},${(64 * v) | 0},${0.12 + r() * 0.3})`;
          g.fillRect(x + 2 + r() * (bw - 5), row * rowH + 2 + r() * (rowH - 5), 1 + r() * 3, 1 + r() * 2);
        }
        x += bw;
      }
    }

    // render coat on top, eroded in patches
    const img = g.getImageData(0, 0, w, h);
    const noise = (x2, y2) => {
      const n = Math.sin(x2 * 0.031 + y2 * 0.021) * Math.cos(x2 * 0.017 - y2 * 0.026);
      return n * 0.5 + 0.5;
    };
    const rn = mulberry32(205);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n1 = noise(x, y);
        const n2 = noise(x * 3.1 + 40, y * 3.1 - 17);
        const n3 = noise(x * 9.3 - 11, y * 9.3 + 5);
        const cover = n1 * 0.34 + n2 * 0.34 + n3 * 0.32;
        // only the lowest, finely-textured areas lose their render
        if (cover < 0.30) continue;
        const grain = 0.94 + Math.random() * 0.12;
        const i = (y * w + x) * 4;
        img.data[i] = tr * grain;
        img.data[i + 1] = tg * grain;
        img.data[i + 2] = tb * grain;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // stray flakes of render still clinging to the exposed brick
    for (let i = 0; i < 900; i++) {
      const v = 0.8 + rn() * 0.3;
      g.fillStyle = `rgba(${(tr * v) | 0},${(tg * v) | 0},${(tb * v) | 0},${0.5 + rn() * 0.5})`;
      g.beginPath();
      g.ellipse(rn() * w, rn() * h, 1 + rn() * 5, 1 + rn() * 4, rn() * 3, 0, Math.PI * 2);
      g.fill();
    }

    // faded paint wash over the intact render
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(232,224,198,0.30)');
    grad.addColorStop(0.55, 'rgba(210,200,176,0.14)');
    grad.addColorStop(1, 'rgba(120,128,96,0.16)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // rain streaks
    for (let i = 0; i < 30; i++) {
      const x0 = r() * w;
      g.fillStyle = `rgba(70,66,54,${0.03 + r() * 0.09})`;
      g.fillRect(x0, 0, 2 + r() * 8, h * (0.3 + r() * 0.7));
    }
    // hairline cracks following the render failure
    for (let i = 0; i < 22; i++) {
      g.strokeStyle = `rgba(58,52,44,${0.22 + r() * 0.30})`;
      g.lineWidth = 0.6 + r() * 1.2;
      let cx = r() * w, cy = r() * h;
      g.beginPath(); g.moveTo(cx, cy);
      for (let k = 0; k < 6; k++) {
        cx += (r() - 0.5) * 30; cy += (r() - 0.5) * 34;
        g.lineTo(cx, cy);
      }
      g.stroke();
    }
    // damp shadow gathering at the bottom of the wall
    for (let i = 0; i < 30; i++) {
      const v = 34 + r() * 40;
      g.fillStyle = `rgba(${(v * 0.62) | 0},${v | 0},${(v * 0.5) | 0},${0.05 + r() * 0.16})`;
      g.beginPath();
      g.ellipse(r() * w, h - r() * h * 0.45, 14 + r() * 64, 8 + r() * 34, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  return {
    map: texFrom(c, { repeat }),
    normal: normalFromCanvas(c, 3.0),
  };
}

/* -------------------------------------------------------------- wood */
export function woodSurface(repeat = 1) {
  const c = makeCanvas(512, 512, (g, w, h) => {
    const r = mulberry32(29);
    g.fillStyle = '#4a3a26'; g.fillRect(0, 0, w, h);
    const planks = 4, pw = w / planks;
    for (let p = 0; p < planks; p++) {
      const base = 62 + r() * 42;
      const x0 = p * pw;
      g.fillStyle = `rgb(${(base * 1.22) | 0},${(base * 0.92) | 0},${(base * 0.62) | 0})`;
      g.fillRect(x0 + 2, 0, pw - 4, h);
      // long grain
      for (let i = 0; i < 130; i++) {
        const v = base + (r() - 0.5) * 70;
        g.strokeStyle = `rgba(${(v * 1.15) | 0},${(v * 0.82) | 0},${(v * 0.52) | 0},${0.1 + r() * 0.42})`;
        g.lineWidth = 0.5 + r() * 2.2;
        const gx = x0 + 3 + r() * (pw - 6);
        g.beginPath();
        g.moveTo(gx, 0);
        for (let y = 0; y < h; y += 24) {
          g.lineTo(gx + Math.sin(y * 0.02 + p + r()) * (1.5 + r() * 2.5), y);
        }
        g.stroke();
      }
      // knots
      if (r() > 0.4) {
        const kx = x0 + pw * (0.25 + r() * 0.5), ky = r() * h;
        for (let k = 5; k > 0; k--) {
          g.strokeStyle = `rgba(${(40 + k * 8) | 0},${(28 + k * 6) | 0},${(16 + k * 4) | 0},0.55)`;
          g.lineWidth = 1.1;
          g.beginPath();
          g.ellipse(kx, ky, k * 3.2, k * 1.9, r(), 0, Math.PI * 2);
          g.stroke();
        }
      }
      // grain splits
      for (let i = 0; i < 4; i++) {
        g.strokeStyle = 'rgba(28,20,12,0.55)';
        g.lineWidth = 0.8 + r();
        const gx = x0 + 4 + r() * (pw - 8);
        const gy = r() * h;
        g.beginPath(); g.moveTo(gx, gy);
        g.lineTo(gx + (r() - 0.5) * 5, gy + 40 + r() * 90);
        g.stroke();
      }
      // plank gap shadow
      g.fillStyle = 'rgba(16,11,7,0.85)';
      g.fillRect(x0, 0, 3, h);
      g.fillStyle = 'rgba(255,240,214,0.05)';
      g.fillRect(x0 + 3, 0, 2, h);
    }
    // horizontal cross beams
    for (const y of [h * 0.18, h * 0.72]) {
      g.fillStyle = 'rgba(58,44,28,0.9)';
      g.fillRect(0, y, w, 26);
      g.fillStyle = 'rgba(12,8,5,0.55)';
      g.fillRect(0, y + 26, w, 4);
      // iron bolts
      for (let i = 0; i < 6; i++) {
        const bx = (i + 0.5) * (w / 6);
        g.fillStyle = 'rgba(96,88,74,0.9)';
        g.beginPath(); g.arc(bx, y + 13, 3.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(30,26,20,0.8)';
        g.beginPath(); g.arc(bx + 0.8, y + 14, 1.10, 0, Math.PI * 2); g.fill();
      }
    }
    // weathering: sun-bleached top, damp dark bottom
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(210,190,150,0.10)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(18,22,12,0.28)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  return {
    map: texFrom(c, { repeat }),
    normal: normalFromCanvas(c, 2.4),
  };
}

/* ------------------------------------------------------------ ground */
export function groundSurface(repeat = 200) {
  const c = makeCanvas(512, 512, (g, w, h) => {
    const r = mulberry32(53);
    g.fillStyle = '#5c5348'; g.fillRect(0, 0, w, h);
    // soil mottling
    for (let i = 0; i < 1400; i++) {
      const v = 46 + r() * 74;
      g.fillStyle = `rgba(${(v * 1.02) | 0},${(v * 0.92) | 0},${(v * 0.74) | 0},${0.08 + r() * 0.3})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 3 + r() * 26, 2 + r() * 18, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // fine grass strokes
    for (let i = 0; i < 2600; i++) {
      const v = 60 + r() * 80;
      g.strokeStyle = `rgba(${(v * 0.92) | 0},${v | 0},${(v * 0.74) | 0},${0.12 + r() * 0.4})`;
      g.lineWidth = 0.6 + r() * 1.2;
      const x0 = r() * w, y0 = r() * h;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (r() - 0.5) * 6, y0 - 2 - r() * 7); g.stroke();
    }
    // pebbles + organic litter
    for (let i = 0; i < 260; i++) {
      const v = 60 + r() * 70;
      g.fillStyle = `rgba(${v | 0},${(v * 0.96) | 0},${(v * 0.86) | 0},${0.3 + r() * 0.5})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 1.2 + r() * 3.4, 1 + r() * 2.4, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${(70 + r() * 40) | 0},${(50 + r() * 26) | 0},${(24 + r() * 14) | 0},${0.25 + r() * 0.4})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 2 + r() * 5, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  // push contrast: a low-contrast tile turns into flat mud once mipmapped
  const cx = c.getContext('2d');
  const id = cx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < id.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = id.data[i + k] / 255;
      id.data[i + k] = Math.max(0, Math.min(255, (v * v * (3 - 2 * v) * 0.85 + 0.075) * 255)) | 0;
    }
  }
  cx.putImageData(id, 0, 0);

  return {
    map: texFrom(c, { repeat }),
    normal: normalFromCanvas(c, 2.0),
  };
}

/* --------------------------------------------------------------- bark */
export function barkSurface(repeat = 1) {
  const c = makeCanvas(256, 512, (g, w, h) => {
    const r = mulberry32(71);
    g.fillStyle = '#4b4032'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 40 + r() * 60;
      g.fillStyle = `rgba(${(v * 1.1) | 0},${(v * 0.95) | 0},${(v * 0.76) | 0},${0.2 + r() * 0.5})`;
      const x = r() * w;
      g.fillRect(x, r() * h, 1 + r() * 4, 12 + r() * 90);
    }
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${(26 + r() * 20) | 0},${(20 + r() * 16) | 0},${(14 + r() * 12) | 0},${0.35 + r() * 0.45})`;
      g.lineWidth = 1 + r() * 3.4;
      let x = r() * w;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y < h; y += 20) {
        x += (r() - 0.5) * 9;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const v = 46 + r() * 30;
      g.fillStyle = `rgba(${(v * 0.5) | 0},${v | 0},${(v * 0.42) | 0},${0.05 + r() * 0.2})`;
      g.beginPath();
      g.ellipse(r() * w, h - r() * h * 0.6, 6 + r() * 26, 4 + r() * 16, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  return { map: texFrom(c, { repeat }), normal: normalFromCanvas(c, 3.0) };
}

/* --------------------------------------------------------- AO / decals */
export function aoBlobTexture() {
  const c = makeCanvas(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.42)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  return texFrom(c, { clamp: true });
}

/* ------------------------------------------------------------ geometry */
/**
 * Box with a 45° chamfer around every edge. Keeps hard faces flat but gives
 * edges a highlight band, which is what makes real objects read as objects.
 */
export function chamferedBox(bevel = 0.055, sub = 2) {
  const base = new THREE.BoxGeometry(1, 1, 1, sub, sub, sub).toNonIndexed();
  const pos = base.attributes.position;
  const inner = 0.5 - bevel;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    q.set(
      Math.max(-inner, Math.min(inner, v.x)),
      Math.max(-inner, Math.min(inner, v.y)),
      Math.max(-inner, Math.min(inner, v.z)),
    );
    const d = v.clone().sub(q);
    const len = d.length();
    if (len > 1e-6) {
      d.multiplyScalar(bevel / len);
      v.copy(q).add(d);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();
  base.computeBoundingSphere();
  return base;
}

/* ================================================================== *
 *  Triplanar projection: world-space material scale for merged meshes
 * ================================================================== */
export function triplanar(mat, scale = 0.4, normalStrength = 0.55) {
  mat.userData.triScale = scale;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTriScale = { value: scale };
    shader.uniforms.uTriNormal = { value: normalStrength };
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vTriP;
varying vec3 vTriN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTriP = position;
vTriN = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTriP;
varying vec3 vTriN;
uniform float uTriScale;
uniform float uTriNormal;
vec3 triWeights(vec3 n){
  vec3 b = pow(abs(n), vec3(6.0));
  return b / max(1e-4, b.x + b.y + b.z);
}
vec4 triSample(sampler2D t, vec3 p){
  // box faces have a constant normal, so the dominant axis alone is enough:
  // one fetch instead of three, no visible seams on architecture
  vec3 n = abs(normalize(vTriN));
  if (n.y >= n.x && n.y >= n.z) return texture2D(t, p.xz);
  if (n.x >= n.z) return texture2D(t, p.zy);
  return texture2D(t, p.xy);
}`)
      .replace('#include <map_fragment>', `
  vec3 triP = vTriP * uTriScale;
  vec4 triAlb = triSample(map, triP);
  diffuseColor *= triAlb;
`);

    if (mat.normalMap) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_maps>', `
  vec3 triW = normalize(vTriN);
  vec3 triNt = triSample(normalMap, triP).xyz * 2.0 - 1.0;
  vec3 axis = abs(triW);
  vec3 slope = axis.y >= axis.x && axis.y >= axis.z ? vec3(triNt.x,0.,triNt.y)
    : axis.x >= axis.z ? vec3(0.,triNt.y,triNt.x) : vec3(triNt.xy,0.);
  vec3 triWs = normalize(triW + (slope - triW * dot(slope,triW)) * uTriNormal);
  normal = normalize((viewMatrix * vec4(triWs, 0.0)).xyz);
`);
    }
  };
  mat.needsUpdate = true;
  return mat;
}
