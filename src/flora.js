import * as THREE from '../vendor/three.module.js';
import {
  GeoBuilder, M4, clamp, lerp, rnd, rr, mulberry32, smoothstep,
  grassTexture, fernTexture, leafCardTexture, stoneTexture, stoneSurface, windify, barkSurface, fbm2,
  palmFrondTexture, triplanar, wildflowerTexture,
} from './util.js';
import { terrainHeight, pathCenterX } from './env.js';

function withWind(geo, fn) {
  const p = geo.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  geo.setAttribute('aWind', new THREE.BufferAttribute(a, 1));
  return geo;
}

function noiseSphere(radius, detail, amp, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const r = mulberry32(seed);
  const v = new THREE.Vector3();
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let s = cache.get(key);
    if (s === undefined) { s = 1 + (r() - 0.5) * amp; cache.set(key, s); }
    v.multiplyScalar(s);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function frondGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 9);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    const w = (0.16 + Math.sin(t * Math.PI) * 0.92) * (1 - t * 0.55);
    p.setX(i, p.getX(i) * w);
    p.setY(i, t);
    p.setZ(i, -Math.pow(t, 1.7) * 0.5);
  }
  g.computeVertexNormals();
  return g;
}

export function createFlora(scene, colliders) {
  const blocked = (x, z, margin = 0.3) => {
    for (const c of colliders) {
      if (x > c.minX - margin && x < c.maxX + margin && z > c.minZ - margin && z < c.maxZ + margin) return true;
    }
    return false;
  };
  const nearCollider = (x, z, dist) => {
    for (const c of colliders) {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      if (Math.hypot(x - cx, z - cz) < dist) return true;
    }
    return false;
  };
  const onPath = (x, z) => Math.abs(x - pathCenterX(z)) < 2.2 && z > -22 && z < 16;

  // grass grows in patches; between them the bare soil shows
  const grassPatch = (x, z) => smoothstep(0.38, 0.55, fbm2(x * 0.055, z * 0.055, 3));

  const samples = [];
  const rand = mulberry32(20240611);
  const GRASS_TARGET = new URLSearchParams(location.search).get('q') === 'low' ? 6000 : 14000;
  for (let i = 0; i < 150000 && samples.length < GRASS_TARGET; i++) {
    const a = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand()) * 62;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad * 0.95 - 6;
    const y = terrainHeight(x, z);
    if (y < 0.75) continue;
    if (blocked(x, z, 0.25)) continue;
    if (onPath(x, z) && rand() > 0.12) continue;
    // thin, scattered blades in the dirt; dense turf inside a patch
    const m = grassPatch(x, z);
    if (rand() > 0.26 + m * 0.74) continue;
    samples.push({ x, z, y, lush: m });
  }

  const groups = {};

  /* ------------------------------------------------------------ grass */
  {
    // four clump shapes: a meadow is never made of one identical tuft
    const shapes = [
      { planes: 3, w: 0.60, h: 0.46, bend: 0.0 },
      { planes: 3, w: 0.46, h: 0.60, bend: 0.12 },
      { planes: 2, w: 0.78, h: 0.34, bend: -0.08 },
      { planes: 3, w: 0.40, h: 0.52, bend: 0.20 },
    ];
    const mat = new THREE.MeshStandardMaterial({
      map: grassTexture(), alphaTest: 0.38, side: THREE.DoubleSide,
      roughness: 0.66, metalness: 0, vertexColors: true,
    });
    windify(mat, 0.11, 1.7);

    const geos = shapes.map((sh, i) => {
      const gb = new GeoBuilder();
      const plane = new THREE.PlaneGeometry(sh.w, sh.h, 1, 1);
      plane.translate(0, sh.h * 0.5, 0);
      // bend the card so blades splay instead of forming a flat fan
      const pos = plane.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const yy = pos.getY(v) / sh.h;
        pos.setX(v, pos.getX(v) * (1 - yy * 0.22));
        pos.setZ(v, pos.getZ(v) + yy * yy * sh.bend);
      }
      plane.computeVertexNormals();
      const wfn = (yy) => clamp(yy / sh.h, 0, 1);
      for (let k = 0; k < sh.planes; k++) {
        gb.add(plane, M4(0, 0, 0, 0, (k / sh.planes) * Math.PI * 1.6 + i * 0.4, 0,
          1 + rr(-0.12, 0.12), 1, 1), new THREE.Color(1, 1, 1), wfn);
      }
      return gb.build();
    });

    const buckets = shapes.map(() => []);
    for (let i = 0; i < samples.length; i++) buckets[i % shapes.length].push(samples[i]);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc3 = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    shapes.forEach((sh, si) => {
      const list = buckets[si];
      const mesh = new THREE.InstancedMesh(geos[si], mat, list.length);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const tall = rnd() > 0.78;
        const sc = tall ? rr(0.95, 1.40) : rr(0.38, 0.66);
        const lush = p.lush === undefined ? 1 : 0.55 + p.lush * 0.85;
        pos.set(p.x, p.y - 0.03, p.z);
        q.setFromEuler(new THREE.Euler(rr(-0.06, 0.06), rnd() * Math.PI * 2, rr(-0.06, 0.06)));
        sc3.set(sc * lush * 0.85, sc * lush * rr(0.7, 1.5), sc * lush * 0.85);
        m.compose(pos, q, sc3);
        mesh.setMatrixAt(i, m);
        // wide chrome range: yellow-green, olive, sun-bleached, deep shade
        const t = rnd();
        col.setHSL(0.16 + t * 0.14, 0.30 + t * 0.34, 0.30 + t * 0.34);
        if (rnd() > 0.86) col.setHSL(0.11 + rnd() * 0.05, 0.42, 0.52); // dry straw
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      if (si === 0) groups.grass = mesh;
    });
  }

  /* -------------------------------------------------------- wildflowers */
  {
    // clumps of small flowers, the thing that makes meadow grass read as alive
    const gb = new GeoBuilder();
    const card = new THREE.PlaneGeometry(0.62, 0.62, 1, 1);
    card.translate(0, 0.30, 0);
    for (let k = 0; k < 2; k++) {
      gb.add(card, M4(0, 0, 0, 0, (k / 2) * Math.PI + 0.3, 0, 1, 1, 1),
        new THREE.Color(1, 1, 1), (yy) => clamp(yy / 0.62, 0, 1));
    }
    const geo = gb.build();
    const mat = new THREE.MeshStandardMaterial({
      map: wildflowerTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.82, metalness: 0, vertexColors: true,
    });
    windify(mat, 0.075, 1.9);

    const pts = [];
    const rw = mulberry32(8821);
    for (let i = 0; i < 24000 && pts.length < 1500; i++) {
      const a = rw() * Math.PI * 2;
      const rad = Math.sqrt(rw()) * 58;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad * 0.95 - 6;
      const y = terrainHeight(x, z);
      if (y < 0.85) continue;
      if (blocked(x, z, 0.3)) continue;
      if (onPath(x, z)) continue;
      if (grassPatch(x, z) < 0.55) continue;      // flowers live in the lush patches
      if (rw() > 0.42) continue;                   // and only in clumps
      pts.push({ x, y, z });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc3 = new THREE.Vector3(), pv = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sc = rr(0.7, 1.25);
      pv.set(p.x, p.y - 0.04, p.z);
      q.setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0));
      sc3.set(sc * rr(0.9, 1.25), sc * rr(0.85, 1.3), sc * rr(0.9, 1.25));
      m.compose(pv, q, sc3);
      mesh.setMatrixAt(i, m);
      // per-clump tint so a meadow isn't one shade of yellow
      const k = rnd();
      if (k < 0.10) col.setRGB(1.0, 0.98, 0.94);            // white
      else if (k < 0.22) col.setRGB(0.82, 0.72, 1.0);       // violet
      else if (k < 0.34) col.setRGB(1.0, 0.62, 0.52);       // salmon
      else col.setRGB(0.96 + rnd() * 0.12, 0.88 + rnd() * 0.18, 0.52 + rnd() * 0.2);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    groups.flower = mesh;
  }

  /* ------------------------------------------------------------ ferns */
  {
    const gb = new GeoBuilder();
    const plane = new THREE.PlaneGeometry(0.92, 0.92, 1, 1);
    plane.translate(0, 0.44, 0);
    for (let k = 0; k < 2; k++) {
      gb.add(plane, M4(0, 0, 0, 0, (k / 2) * Math.PI + 0.4, 0, 1, 1, 1),
        new THREE.Color(1, 1, 1), (yy) => clamp(yy / 0.9, 0, 1));
    }
    const geo = gb.build();
    const mat = new THREE.MeshStandardMaterial({
      map: fernTexture(), alphaTest: 0.36, side: THREE.DoubleSide,
      roughness: 0.9, metalness: 0, vertexColors: true,
    });
    windify(mat, 0.10, 1.3);

    const pts = [];
    const r2 = mulberry32(777);
    for (let i = 0; i < 3600 && pts.length < 620; i++) {
      const a = r2() * Math.PI * 2;
      const rad = Math.sqrt(r2()) * 46;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad * 0.95 - 8;
      const y = terrainHeight(x, z);
      if (y < 0.8) continue;
      if (blocked(x, z, 0.3)) continue;
      if (onPath(x, z)) continue;
      // overgrowth hugs the ruins
      if (!nearCollider(x, z, 9) && r2() > 0.45) continue;
      pts.push({ x, y, z });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sc = rr(0.55, 1.05);
      pv.set(p.x, p.y - 0.05, p.z);
      q.setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0));
      s.set(sc, sc * rr(0.85, 1.2), sc);
      m.compose(pv, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    groups.fern = mesh;
  }

  /* ----------------------------------------------------------- bushes */
  {
    // bush = small cloud of leaf cards, same idea as the tree canopy
    const bg = new GeoBuilder();
    const bcard = new THREE.PlaneGeometry(1, 1, 1, 1);
    for (let k = 0; k < 34; k++) {
      const a = rr(0, Math.PI * 2);
      const b = Math.acos(rr(-1, 1));
      const rad = Math.pow(rr(0.3, 1.0), 0.45);
      const lx = Math.sin(b) * Math.cos(a) * 0.95 * rad;
      const ly = 0.55 + Math.cos(b) * 0.62 * rad;
      const lz = Math.sin(b) * Math.sin(a) * 0.95 * rad;
      const size = rr(0.55, 1.0);
      const up = clamp(ly / 1.15, 0, 1);
      const tint = 0.5 + up * 0.7;
      const bd = new THREE.Vector3(lx, (ly - 0.55) * 1.4 + 0.2, lz).normalize();
      const bq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), bd);
      const broll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rr(0, Math.PI * 2));
      bg.add(bcard,
        new THREE.Matrix4().compose(new THREE.Vector3(lx, ly, lz), bq.multiply(broll),
          new THREE.Vector3(size, size, 1)),
        new THREE.Color(tint * 0.86, tint, tint * 0.66), (yy) => clamp(yy / 1.2, 0, 1));
    }
    const geo = bg.build();
    const mat = new THREE.MeshStandardMaterial({
      map: leafCardTexture(), alphaTest: 0.36, side: THREE.DoubleSide,
      vertexColors: true, roughness: 0.88, metalness: 0,
    });
    windify(mat, 0.05, 1.1);
    const pts = [];
    const r3 = mulberry32(4242);
    for (let i = 0; i < 1500 && pts.length < 230; i++) {
      const a = r3() * Math.PI * 2;
      const rad = Math.sqrt(r3()) * 52;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.95 - 8;
      const y = terrainHeight(x, z);
      if (y < 0.9) continue;
      if (blocked(x, z, 0.8)) continue;
      if (onPath(x, z)) continue;
      if (Math.hypot(x, z - 13) < 7) continue;   // keep the spawn shot clear
      pts.push({ x, y, z });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sc = rr(0.6, 1.7);
      pv.set(p.x, p.y + 0.1, p.z);
      q.setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0));
      s.set(sc, sc * rr(0.6, 1.0), sc);
      m.compose(pv, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    groups.bush = mesh;
  }

  /* ------------------------------------------------------------ palms */
  {
    // palms generated from a seed: height, trunk arc, frond count and droop differ
    const buildPalm = (seed) => {
      const r = mulberry32(seed);
      const rl = (a, b) => a + r() * (b - a);
      const gb = new GeoBuilder();

      const H = rl(4.2, 8.2);
      const curve = rl(-0.45, 0.55);
      const r0 = rl(0.16, 0.30);
      const barkTone = rl(0.36, 0.50);

      // trunk: tapered tube along an arc, with ring scars
      const segs = 11;
      let px = 0, py = 0;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const h = H / segs;
        const a0 = curve * t0 * t0, a1 = curve * t1 * t1;
        const x1 = px + Math.sin(a0) * h, y1 = py + Math.cos(a0) * h;
        const rad = r0 * (1 - t0 * 0.58);
        gb.add(new THREE.CylinderGeometry(rad * 0.90, rad, h * 1.06, 7, 1),
          M4((px + x1) / 2, (py + y1) / 2, 0, 0, 0, -a1, 1, 1, 1),
          new THREE.Color(barkTone, barkTone * 0.80, barkTone * 0.55),
          (yy) => clamp(yy / H, 0, 1) * 0.35);
        px = x1; py = y1;
      }
      // trunk collar: a flared base, and dead-frond stubs at the crown
      gb.add(new THREE.CylinderGeometry(r0 * 1.5, r0 * 2.1, r0 * 1.6, 8, 1),
        M4(0, r0 * 0.5, 0, 0, 0, 0, 1, 1, 1),
        new THREE.Color(barkTone * 0.86, barkTone * 0.7, barkTone * 0.5), 0);

      const topX = px, topY = py;

      // crown: fronds with leaflets along a drooping rib
      const fronds = 7 + ((r() * 6) | 0);
      const baseLen = rl(1.7, 3.1);
      for (let f = 0; f < fronds; f++) {
        const az = (f / fronds) * Math.PI * 2 + rl(-0.2, 0.2);
        const droop = rl(0.42, 0.95);
        const frondLen = baseLen * rl(0.8, 1.2);
        const ribSteps = 9;
        let rx = topX, ry = topY, rz = 0;
        let ang = -0.42 + rl(-0.15, 0.15);
        const cx = Math.cos(az), cz = Math.sin(az);
        for (let k = 1; k <= ribSteps; k++) {
          const t = k / ribSteps;
          ang += droop * 0.19;
          const step = frondLen / ribSteps;
          const nx = rx + Math.sin(ang) * step * 0.55 * cx;
          const nz = rz + Math.sin(ang) * step * 0.55 * cz;
          const ny = ry + Math.cos(ang) * step;
          const midX = (rx + nx) / 2, midY = (ry + ny) / 2, midZ = (rz + nz) / 2;
          const leafLen = frondLen * 0.36 * Math.sin(t * Math.PI) * 0.95 + 0.05;
          for (const side of [-1, 1]) {
            const lx = -cz * side, lz = cx * side;
            const tipX = midX + lx * leafLen * 0.85;
            const tipZ = midZ + lz * leafLen * 0.85;
            const tipY = midY - leafLen * 0.46;
            const dx = tipX - midX, dy = tipY - midY, dz = tipZ - midZ;
            const len = Math.hypot(dx, dy, dz) || 1e-4;
            const q = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
            const tone = rl(0.40, 0.66);
            gb.add(new THREE.ConeGeometry(leafLen * 0.15, len, 3, 1),
              new THREE.Matrix4().compose(
                new THREE.Vector3((midX + tipX) / 2, (midY + tipY) / 2, (midZ + tipZ) / 2),
                q, new THREE.Vector3(1, 1, 0.32)),
              new THREE.Color(tone * 0.60, tone, tone * 0.34), 1.0);
          }
          rx = nx; ry = ny; rz = nz;
        }
        // rib
        let rrx = topX, rry = topY, rrz = 0;
        let ang2 = -0.42;
        for (let k = 1; k <= ribSteps; k++) {
          ang2 += droop * 0.19;
          const step = frondLen / ribSteps;
          const nx2 = rrx + Math.sin(ang2) * step * 0.55 * cx;
          const nz2 = rrz + Math.sin(ang2) * step * 0.55 * cz;
          const ny2 = rry + Math.cos(ang2) * step;
          const d = new THREE.Vector3(nx2 - rrx, ny2 - rry, nz2 - rrz);
          const l = d.length() || 1e-4;
          const q2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
          gb.add(new THREE.CylinderGeometry(0.010, 0.020, l * 1.1, 4, 1),
            new THREE.Matrix4().compose(
              new THREE.Vector3((rrx + nx2) / 2, (rry + ny2) / 2, (rrz + nz2) / 2), q2, new THREE.Vector3(1, 1, 1)),
            new THREE.Color(0.30, 0.33, 0.16), 1.0);
          rrx = nx2; rry = ny2; rrz = nz2;
        }
      }
      return gb.build();
    };

    const PALM_VARIANTS = 8;
    const palmGeos = [];
    for (let v = 0; v < PALM_VARIANTS; v++) palmGeos.push(buildPalm(4400 + v * 211));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide,
    });
    windify(mat, 0.055, 0.85);

    const pts = [];
    const r4 = mulberry32(99);
    for (let i = 0; i < 900 && pts.length < 24; i++) {
      const a = r4() * Math.PI * 2;
      const rad = 13 + Math.sqrt(r4()) * 44;
      const px = Math.cos(a) * rad, pz = Math.sin(a) * rad * 0.95 - 10;
      const py = terrainHeight(px, pz);
      if (py < 1.0) continue;
      if (blocked(px, pz, 1.6)) continue;
      if (onPath(px, pz)) continue;
      pts.push({ x: px, y: py, z: pz });
    }

    const buckets = palmGeos.map(() => []);
    pts.forEach((p, i) => buckets[i % PALM_VARIANTS].push(p));

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc3 = new THREE.Vector3();
    const pv = new THREE.Vector3(), col = new THREE.Color();
    const palmMeshes = [];
    buckets.forEach((list, vi) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(palmGeos[vi], mat, list.length);
      list.forEach((p, i) => {
        const sc = rr(0.82, 1.28);
        pv.set(p.x, p.y - 0.1, p.z);
        q.setFromEuler(new THREE.Euler(rr(-0.05, 0.05), rnd() * 6.28, rr(-0.07, 0.07)));
        sc3.set(sc, sc * rr(0.88, 1.22), sc);
        m.compose(pv, q, sc3);
        mesh.setMatrixAt(i, m);
        const t = rr(0.86, 1.10);
        col.setRGB(t, t * rr(0.95, 1.06), t * rr(0.9, 1.0));
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      palmMeshes.push(mesh);
    });
    groups.palm = palmMeshes[0];
  }

  /* ------------------------------------------------------------ trees */
  // every tree is generated from its own seed: trunk arc, branch count/angles,
  // canopy lobes, leaf density and bark tone all differ.
  const buildTree = (seed) => {
    const r = mulberry32(seed);
    const rl = (a, b) => a + r() * (b - a);
    const trunkB = new GeoBuilder();

    const H = rl(4.4, 6.8);
    const rBase = rl(0.26, 0.52);
    const curve = rl(-0.22, 0.22);      // side-to-side arc of the trunk
    const bendFwd = rl(-0.14, 0.14);
    const barkTone = rl(0.14, 0.24);
    const barkHue = rl(0.07, 0.11);
    const bark = new THREE.Color().setHSL(barkHue, rl(0.20, 0.34), barkTone);
    const bark2 = bark.clone().offsetHSL(rl(-0.01, 0.01), 0, rl(-0.04, -0.01));

    // trunk as a chain of tapered segments following the arc
    const segs = 7;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const h = H / segs;
      const a0 = curve * t0 * t0, a1 = curve * t1 * t1;
      const b0 = bendFwd * t0, b1 = bendFwd * t1;
      const x1 = px + Math.sin(a0) * h, y1 = py + Math.cos(a0) * Math.cos(b0) * h;
      const z1 = pz + Math.sin(b0) * h * 0.7;
      const rad = rBase * (1 - t0 * 0.62);
      trunkB.add(new THREE.CylinderGeometry(rad * 0.90, rad, h * 1.05, 6 + ((r() * 3) | 0), 1),
        M4((px + x1) / 2, (py + y1) / 2, (pz + z1) / 2, b1, 0, -a1, 1, 1, 1),
        bark, (yy) => clamp(yy / H, 0, 1) * 0.3);
      px = x1; py = y1; pz = z1;
    }

    // branches: count, height, azimuth, pitch and length are all random
    const branchCount = 2 + ((r() * 4) | 0);
    const branchTips = [];
    for (let k = 0; k < branchCount; k++) {
      const az = r() * Math.PI * 2;
      const at = rl(0.42, 0.88);                 // fraction up the trunk
      const by = H * at;
      const bx = Math.sin(curve * at * at) * by * 0.55;
      const bz = Math.sin(bendFwd * at) * by * 0.4;
      const pitch = rl(0.5, 1.15);               // how horizontal
      const len = rl(1.1, 2.6) * (1 - at * 0.35);
      const thick = rBase * rl(0.24, 0.44);
      const dirX = Math.cos(az) * Math.sin(pitch);
      const dirY = Math.cos(pitch);
      const dirZ = Math.sin(az) * Math.sin(pitch);
      for (let seg = 0; seg < 2; seg++) {
        const f0 = seg / 2, f1 = (seg + 1) / 2;
        const ax = bx + dirX * len * f0, ay = by + dirY * len * f0, az2 = bz + dirZ * len * f0;
        const cx2 = bx + dirX * len * f1, cy2 = by + dirY * len * f1, cz2 = bz + dirZ * len * f1;
        const mid = new THREE.Vector3((ax + cx2) / 2, (ay + cy2) / 2, (az2 + cz2) / 2);
        const d = new THREE.Vector3(cx2 - ax, cy2 - ay, cz2 - az2);
        const l = d.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        trunkB.add(new THREE.CylinderGeometry(thick * (0.72 - f1 * 0.3), thick * (1 - f0 * 0.28), l, 5, 1),
          new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), bark2, 0.35);
      }
      branchTips.push(new THREE.Vector3(bx + dirX * len, by + dirY * len, bz + dirZ * len));
    }

    // canopy: silhouette varies by type, not just radius
    const leafB = new GeoBuilder();
    const card = new THREE.PlaneGeometry(1, 1, 1, 1);
    const ZAX = new THREE.Vector3(0, 0, 1);
    const qz = new THREE.Quaternion(), qr = new THREE.Quaternion();
    const dir = new THREE.Vector3();

    const lobes = [];
    const crownTop = new THREE.Vector3(px, py, pz);
    const crownType = (r() * 5) | 0;   // 0 umbrella, 1 ball, 2 multi, 3 tall, 4 ragged

    if (crownType === 0) {
      // umbrella: wide, flat, sits low over the branches
      lobes.push({ c: crownTop.clone().setY(py - H * 0.10), rx: rl(3.4, 4.6), ry: rl(0.9, 1.3), leaves: 150 + ((r() * 70) | 0) });
      lobes.push({ c: crownTop.clone().setY(py + H * 0.14), rx: rl(1.8, 2.6), ry: rl(0.8, 1.2), leaves: 70 });
    } else if (crownType === 1) {
      lobes.push({ c: crownTop, rx: rl(2.4, 3.4), ry: rl(2.0, 2.9), leaves: 160 + ((r() * 70) | 0) });
    } else if (crownType === 2) {
      // multi: three blobs on separate branch tips, so the outline is lumpy
      const n = 3;
      for (let k = 0; k < n; k++) {
        const tip = branchTips[k % branchTips.length] || crownTop;
        lobes.push({
          c: tip.clone().add(new THREE.Vector3(rl(-0.4, 0.4), rl(-0.2, 0.5), rl(-0.4, 0.4))),
          rx: rl(1.6, 2.5), ry: rl(1.2, 1.9), leaves: 80 + ((r() * 55) | 0),
        });
      }
    } else if (crownType === 3) {
      // tall narrow column of foliage
      for (let k = 0; k < 3; k++) {
        lobes.push({
          c: crownTop.clone().setY(py - H * 0.22 + k * H * 0.16),
          rx: rl(1.5, 2.1), ry: rl(1.1, 1.5), leaves: 70 + ((r() * 40) | 0),
        });
      }
    } else {
      // ragged: one core plus scattered satellites
      lobes.push({ c: crownTop, rx: rl(2.2, 3.0), ry: rl(1.6, 2.3), leaves: 130 });
      for (let k = 0; k < 4; k++) {
        const a2 = r() * Math.PI * 2;
        lobes.push({
          c: crownTop.clone().add(new THREE.Vector3(Math.cos(a2) * rl(1.6, 2.8), rl(-0.8, 0.9), Math.sin(a2) * rl(1.6, 2.8))),
          rx: rl(0.8, 1.5), ry: rl(0.6, 1.1), leaves: 34 + ((r() * 26) | 0),
        });
      }
    }

    const leafTone = rl(0.34, 0.50);
    for (const lobe of lobes) {
      for (let k = 0; k < lobe.leaves; k++) {
        const a2 = rl(0, Math.PI * 2);
        const b2 = Math.acos(rl(-1, 1));
        const rad = Math.pow(rl(0.26, 1.06), 0.44);
        const lx = Math.sin(b2) * Math.cos(a2) * lobe.rx * rad;
        const ly = Math.cos(b2) * lobe.ry * rad;
        const lz = Math.sin(b2) * Math.sin(a2) * lobe.rx * rad;
        const size = rl(0.85, 2.6);
        const up = (ly / lobe.ry + 1) * 0.5;
        dir.set(lx / lobe.rx, ly / lobe.ry * 0.7 + 0.15, lz / lobe.rx).normalize();
        qz.setFromUnitVectors(ZAX, dir);
        qr.setFromAxisAngle(ZAX, rl(0, Math.PI * 2));
        const shade = 0.58 + up * 0.66;
        leafB.add(card,
          new THREE.Matrix4().compose(
            new THREE.Vector3(lobe.c.x + lx, lobe.c.y + ly, lobe.c.z + lz),
            qz.clone().multiply(qr),
            new THREE.Vector3(size, size, 1)),
          new THREE.Color(shade * leafTone * 0.72, shade * leafTone, shade * leafTone * 0.42),
          1.0);
      }
    }

    return { trunk: trunkB.build(), leaves: leafB.build(), height: H };
  };

  // 10 distinct trees, so nothing on the island repeats
  const VARIANTS = 10;
  const variants = [];
  for (let v = 0; v < VARIANTS; v++) variants.push(buildTree(9001 + v * 137));

  const treePts = [];
  {
    const r5 = mulberry32(5150);
    for (let i = 0; i < 900 && treePts.length < 34; i++) {
      const a = r5() * Math.PI * 2;
      const rad = 12 + Math.sqrt(r5()) * 48;
      const px = Math.cos(a) * rad, pz = Math.sin(a) * rad * 0.95 - 12;
      const py = terrainHeight(px, pz);
      if (py < 1.2) continue;
      if (blocked(px, pz, 2.2)) continue;
      if (onPath(px, pz)) continue;
      if (Math.abs(px) < 18 && pz < -21) continue;
      if (Math.hypot(px - 4, pz - 17) < 13) continue;
      treePts.push({ x: px, y: py, z: pz });
    }
  }

  const trunkMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0,
  });
  windify(trunkMat, 0.045, 0.7);
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafCardTexture(), alphaTest: 0.34, side: THREE.DoubleSide,
    roughness: 0.62, metalness: 0, vertexColors: true,
  });
  windify(leafMat, 0.075, 1.0);

  // one instanced mesh per variant, each used roughly three times
  const buckets = variants.map(() => []);
  treePts.forEach((p, i) => buckets[i % VARIANTS].push(p));

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc3 = new THREE.Vector3();
  const pv = new THREE.Vector3(), col = new THREE.Color();
  buckets.forEach((list, vi) => {
    if (!list.length) return;
    const trunkMesh = new THREE.InstancedMesh(variants[vi].trunk, trunkMat, list.length);
    const leafMesh = new THREE.InstancedMesh(variants[vi].leaves, leafMat, list.length);
    list.forEach((p, i) => {
      const sc = rr(0.90, 1.22);
      pv.set(p.x, p.y - 0.2, p.z);
      q.setFromEuler(new THREE.Euler(rr(-0.03, 0.03), rnd() * 6.28, rr(-0.05, 0.05)));
      sc3.set(sc, sc * rr(0.86, 1.22), sc);
      m.compose(pv, q, sc3);
      trunkMesh.setMatrixAt(i, m);
      leafMesh.setMatrixAt(i, m);
      // near-neutral tint keeps bark brown while varying brightness per tree
      col.setRGB(rr(0.82, 1.10), rr(0.86, 1.06), rr(0.78, 1.00));
      trunkMesh.setColorAt(i, col);
      col.setRGB(rr(0.85, 1.10), rr(0.88, 1.12), rr(0.80, 1.02));
      leafMesh.setColorAt(i, col);
    });
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    leafMesh.castShadow = false;
    leafMesh.receiveShadow = false;
    for (const mesh of [trunkMesh, leafMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    if (vi === 0) { groups.tree = trunkMesh; groups.treeLeaf = leafMesh; }
  });

  /* --------------------------------------------------------- treeline */
  {
    // distant jungle rim: big crowns clustering into bands, so the horizon
    // reads as deep forest dissolving into mist rather than a hard cutout
    const gb = new GeoBuilder();
    const card = new THREE.PlaneGeometry(1, 1, 1, 1);
    const ZAX = new THREE.Vector3(0, 0, 1);
    const qz = new THREE.Quaternion(), qr = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const rt = mulberry32(60607);

    // plant several crown clusters at increasing radii
    const bands = [54, 70, 86, 102];
    for (const radBase of bands) {
      const clusterCount = 8 + ((rt() * 6) | 0);
      for (let i = 0; i < clusterCount; i++) {
        const a = rt() * Math.PI * 2;
        const rad = radBase * (0.78 + rt() * 0.34);
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad * 0.95 - 12;
        const y = terrainHeight(x, z);
        if (y < 0.2) continue;
        const cx = x, cz = z;
        const trunkH = 3.4 + rt() * 3.6;
        const crownR = 2.6 + rt() * 2.4;
        const crownH = 1.6 + rt() * 1.4;
        const lobeCount = 1 + ((rt() * 3) | 0);

        // trunk
        for (let seg = 0; seg < 2; seg++) {
          const t0 = seg / 2, t1 = (seg + 1) / 2;
          const ax = cx, ay = y + trunkH * t0, az = cz;
          const bx = cx + Math.sin(rt() * 0.6 - 0.3) * trunkH * 0.18 * (t1 - t0);
          const bz = cz + Math.sin(rt() * 0.6 - 0.3) * trunkH * 0.14 * (t1 - t0);
          const mid = new THREE.Vector3((ax + bx) / 2, ay + trunkH * 0.5 * t1, (az + bz) / 2);
          const d = new THREE.Vector3(bx - ax, trunkH * 0.5 * (t1 - t0), bz - az);
          const len = d.length() || 1;
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
          gb.add(new THREE.CylinderGeometry(0.13, 0.18, len, 5, 1),
            new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)),
            new THREE.Color(0.40 + rt() * 0.08, 0.32 + rt() * 0.06, 0.22 + rt() * 0.04), 0.25);
        }

        // crown lobes
        for (let k = 0; k < lobeCount; k++) {
          const nLeaves = 30 + ((rt() * 26) | 0);
          const offX = rt() * crownR * 0.5 - crownR * 0.25;
          const offZ = rt() * crownR * 0.5 - crownR * 0.25;
          const rx = crownR * rt(), ry = crownH * rt(), rz = crownR * rt();
          // crown sits on the trunk top, slight overlap so it never floats
          const cy = y + trunkH + crownH * 0.5;
          const lr = mulberry32(Math.round((x * 100003 + z * 100019 + k * 17) % 100000));
          const lrL = (aa, bb) => aa + lr() * (bb - aa);
          for (let l = 0; l < nLeaves; l++) {
            const a2 = lrL(0, Math.PI * 2);
            const b2 = Math.acos(lrL(-1, 1));
            const rad2 = Math.pow(lrL(0.30, 1.0), 0.44);
            const lx = Math.sin(b2) * Math.cos(a2) * rx * rad2;
            const ly = Math.cos(b2) * ry * rad2;
            const lz = Math.sin(b2) * Math.sin(a2) * rx * rad2;
            const size = lrL(0.8, 2.2);
            dir.set(lx / rx, ly / ry * 0.75 + 0.2, lz / rx).normalize();
            qz.setFromUnitVectors(ZAX, dir);
            qr.setFromAxisAngle(ZAX, lrL(0, Math.PI * 2));
            const shade = 0.60 + (ly / ry) * 0.55;
            gb.add(card,
              new THREE.Matrix4().compose(
                new THREE.Vector3(cx + offX + lx, cy + ly, cz + offZ + lz),
                qz.clone().multiply(qr), new THREE.Vector3(size, size, 1)),
              new THREE.Color(shade * 0.42 * 0.72, shade * 0.42, shade * 0.42 * 0.40), 1.0);
          }
        }
      }
    }
    const geo = gb.build();
    const mat = new THREE.MeshStandardMaterial({
      map: leafCardTexture(), alphaTest: 0.34, side: THREE.DoubleSide,
      roughness: 0.70, metalness: 0, vertexColors: true,
    });
    windify(mat, 0.015, 0.45);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  /* ------------------------------------------------------- ground litter */  /* ------------------------------------------------------- ground litter */
  {
    // fallen leaves lying flat, plus chipped stone near the ruins
    const leafLitter = new GeoBuilder();
    const lcard = new THREE.PlaneGeometry(1, 1, 1, 1);
    // flatten into a leaf-ish blade
    {
      const pos = lcard.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * 2, y = pos.getY(i) * 2;
        pos.setZ(i, Math.abs(x) * 0.18);
      }
      lcard.rotateX(-Math.PI / 2);
      lcard.computeVertexNormals();
    }
    const rl = mulberry32(31313);
    const leafPts = [];
    for (let i = 0; i < 5200 && leafPts.length < 1500; i++) {
      const a = rl() * Math.PI * 2;
      const rad = Math.sqrt(rl()) * 56;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.95 - 6;
      const y = terrainHeight(x, z);
      if (y < 0.7) continue;
      if (blocked(x, z, 0.05)) continue;
      leafPts.push({ x, y, z, s: rr(0.09, 0.26) });
    }
    for (const p of leafPts) {
      const tone = rr(0.30, 0.72);
      const dry = rl() > 0.62;
      leafLitter.add(lcard,
        M4(p.x, p.y + 0.012, p.z, rr(-0.06, 0.06), rl() * 6.28, rr(-0.06, 0.06), p.s, 1, p.s * rr(0.7, 1.2)),
        dry ? new THREE.Color(tone * 1.5, tone * 1.12, tone * 0.5)
          : new THREE.Color(tone * 0.75, tone * 1.15, tone * 0.44), 0);
    }
    const litterMat = new THREE.MeshStandardMaterial({
      map: leafCardTexture(), alphaTest: 0.34, side: THREE.DoubleSide,
      roughness: 0.92, metalness: 0, vertexColors: true,
    });
    const litter = new THREE.Mesh(leafLitter.build(), litterMat);
    litter.receiveShadow = false;
    litter.frustumCulled = false;
    scene.add(litter);

    // chipped masonry: small flat stones around the ruins
    const chipB = new GeoBuilder();
    const chipGeo = noiseSphere(1, 0, 0.9, 8123);
    const rc = mulberry32(778);
    const chips = [];
    for (let i = 0; i < 3200 && chips.length < 420; i++) {
      const a = rc() * Math.PI * 2;
      const rad = 6 + Math.sqrt(rc()) * 30;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.95 - 16;
      const y = terrainHeight(x, z);
      if (y < 0.7) continue;
      if (blocked(x, z, 0.1)) continue;
      chips.push({ x, y, z, s: rr(0.06, 0.24) });
    }
    for (const c of chips) {
      const tone = rr(0.55, 0.85);
      chipB.add(chipGeo,
        M4(c.x, c.y + c.s * 0.35, c.z, rr(0, 3), rr(0, 6.28), rr(0, 3), c.s, c.s * rr(0.35, 0.7), c.s * rr(0.7, 1.2)),
        new THREE.Color(tone, tone * 0.98, tone * 0.92), 0);
    }
    const chipMat = new THREE.MeshStandardMaterial({
      map: stoneSurface(1).map, vertexColors: true, roughness: 0.95, metalness: 0,
    });
    triplanar(chipMat, 3.0, 0.5);
    const chipMesh = new THREE.Mesh(chipB.build(), chipMat);
    chipMesh.receiveShadow = true;
    chipMesh.frustumCulled = false;
    scene.add(chipMesh);
    groups.litter = litter;
    groups.chips = chipMesh;
  }

  /* ------------------------------------------------------------ rocks */
  {
    const geo = noiseSphere(1, 1, 0.75, 606);
    const rockSurf = stoneSurface(1);
    const mat = new THREE.MeshStandardMaterial({
      map: rockSurf.map, normalMap: rockSurf.normal,
      normalScale: new THREE.Vector2(1.3, 1.3),
      color: 0xb9b3a4, roughness: 0.95, metalness: 0,
    });
    triplanar(mat, 0.42, 0.6);
    const SPAWN_x = 0, SPAWN_z = 13;
    const pts = [];
    const r6 = mulberry32(31337);
    for (let i = 0; i < 600 && pts.length < 14; i++) {
      const a = r6() * Math.PI * 2;
      const rad = Math.sqrt(r6()) * 58;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.95 - 6;
      const y = terrainHeight(x, z);
      if (y < -0.2) continue;
      if (blocked(x, z, 1.0)) continue;
      if (Math.hypot(x - SPAWN_x, z - SPAWN_z) < 9) continue;
      if (Math.abs(x - pathCenterX(z)) < 3.2 && z > -20 && z < 18) continue;
      if (pts.some((q) => Math.hypot(q.x - x, q.z - z) < 16)) continue;
      pts.push({ x, y, z });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sc = rr(1.1, 2.6);
      pv.set(p.x, p.y + sc * 0.15, p.z);
      q.setFromEuler(new THREE.Euler(rr(0, 3), rr(0, 6.28), rr(0, 3)));
      s.set(sc, sc * rr(0.6, 1.0), sc * rr(0.8, 1.2));
      m.compose(pv, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    groups.rock = mesh;
  }

  return { groups };
}
