import * as THREE from '../vendor/three.module.js';
import {
  GeoBuilder, M4, lerp, clamp, smoothstep, rr, rnd, stoneSurface, woodSurface,
  flagTexture, vineTexture, windify, aoBlobTexture, chamferedBox, triplanar, mulberry32,
  fabricNormal, clothify, plasterSurface,
} from './util.js';
import { terrainHeight } from './env.js';

/* ------------------------------------------------------------- helpers */
function mossPass(geo, amount = 0.6, tint = new THREE.Color(0.14, 0.22, 0.09)) {
  const n = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < n.count; i++) {
    const up = n.getY(i);
    const k = smoothstep(0.2, 0.95, up) * amount;
    c.setXYZ(i,
      lerp(c.getX(i), tint.r, k),
      lerp(c.getY(i), tint.g, k),
      lerp(c.getZ(i), tint.b, k));
  }
}

function weatherPass(geo, amount = 0.25) {
  const c = geo.attributes.color, p = geo.attributes.position;
  for (let i = 0; i < c.count; i++) {
    const n = Math.sin(p.getX(i) * 1.7 + p.getZ(i) * 2.3) * 0.5 + 0.5;
    const k = 1 - amount + n * amount * 2;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

/* --------------------------------------------------------------- scene */
export function createRuins(scene) {
  const colliders = [];
  const interactables = [];
  const flags = [];

  const loader = new THREE.TextureLoader();
  const stoneS = {
    map: loader.load('assets/stone/limestone.jpg'),
    normal: loader.load('assets/stone/limestone-normal.png'),
  };
  stoneS.map.colorSpace = THREE.SRGBColorSpace;
  for (const tex of Object.values(stoneS)) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
  }
  const woodS = woodSurface(1);

  const stoneMat = new THREE.MeshStandardMaterial({
    map: stoneS.map, normalMap: stoneS.normal,
    normalScale: new THREE.Vector2(1.15, 1.15),
    vertexColors: true, roughness: 0.93, metalness: 0.02,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodS.map, normalMap: woodS.normal,
    normalScale: new THREE.Vector2(1.25, 1.25),
    vertexColors: true, roughness: 0.74, metalness: 0.05,
  });
  triplanar(stoneMat, 0.85, 0.85);
  triplanar(woodMat, 0.75, 0.7);

  const metalMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0.78, color: 0x9a8a76,
  });
  const fabricNrm = fabricNormal(6);
  const clothMatBase = new THREE.MeshStandardMaterial({
    map: flagTexture(), vertexColors: true, roughness: 0.95, metalness: 0,
    side: THREE.DoubleSide, alphaTest: 0.35,
    normalMap: fabricNrm, normalScale: new THREE.Vector2(0.7, 0.7),
  });

  const plasterS = plasterSurface(1);
  const plasterMat = new THREE.MeshStandardMaterial({
    map: plasterS.map, normalMap: plasterS.normal,
    normalScale: new THREE.Vector2(1.5, 1.5),
    vertexColors: true, roughness: 0.97, metalness: 0,
  });
  triplanar(plasterMat, 0.30, 0.55);
  // salt damp rising from the ground and rain washing down the render
  plasterMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
vPWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPWorld;
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // rising damp: greyer, darker render near the footing
  float damp = 1.0 - smoothstep(0.0, 1.7, vPWorld.y);
  vec3 dampCol = vec3(0.46, 0.47, 0.42);
  diffuseColor.rgb = mix(diffuseColor.rgb, dampCol, damp * 0.55);

  // vertical rain streaks with soft edges
  float streak = wHash(floor(vec2(vPWorld.x * 6.0 + vPWorld.z * 6.0, 0.5)));
  streak = smoothstep(0.55, 1.0, streak);
  float streakFade = smoothstep(0.0, 6.0, vPWorld.y) * 0.22;
  diffuseColor.rgb *= 1.0 - streak * streakFade;

  // green algae creeping up the shaded lower band
  float algae = (1.0 - smoothstep(0.0, 0.9, vPWorld.y)) * wHash(floor(vPWorld.xz * 2.5));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.28, 0.15), algae * 0.45);
}`);
  };

  const stone = new GeoBuilder();
  const wood = new GeoBuilder();
  const metal = new GeoBuilder();
  const plaster = new GeoBuilder();

  const G = {
    box: chamferedBox(0.03, 2),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1),
    cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 7, 1),
    sph: new THREE.SphereGeometry(0.5, 14, 10),
    plank: chamferedBox(0.06, 2),
    torus: new THREE.TorusGeometry(0.5, 0.08, 6, 16),
    cylTaper: new THREE.CylinderGeometry(0.44, 0.5, 1, 18, 1),   // shaft with entasis
    cylFlare: new THREE.CylinderGeometry(0.62, 0.44, 1, 18, 1),  // echinus
  };

  /* soft dark footprint under every prop — the cheapest possible "baked AO" */
  const aoTex = aoBlobTexture();
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex, color: 0x000000, transparent: true, opacity: 0.5,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false,
  });
  const aoGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const aoBlobs = [];
  const aoBlob = (x, z, sx, sz, yOff = 0.02) => { aoBlobs.push({ x, z, sx, sz, yOff }); };

  // h: how tall the obstacle is (used to keep the camera out of walls)
  // top: absolute Y of a walkable surface — the player can step onto it
  const addCollider = (x, z, w, d, tag = '', h = 2.4, top) => {
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
      baseY: terrainHeight(x, z), h, top, tag,
    });
  };

  /* ---------------------------------------------- 1. broken terrace wall */
  {
    const zWall = 3.4;
    const slabs = [
      { x: -13.0, w: 5.2, h: 1.30, tilt: 0.012 },
      { x: -7.4, w: 5.6, h: 1.42, tilt: -0.008 },
      { gap: 2.0 },
      { x: 2.6, w: 4.4, h: 1.20, tilt: 0.02 },
      { x: 8.2, w: 5.4, h: 1.38, tilt: -0.015 },
      { x: 13.6, w: 4.2, h: 1.10, tilt: 0.02 },
    ];
    for (const s of slabs) {
      if (s.gap !== undefined) continue;
      const gy = terrainHeight(s.x, zWall);
      const segs = 3;
      for (let i = 0; i < segs; i++) {
        const sx = s.x + (i - (segs - 1) / 2) * (s.w / segs);
        const h = s.h * (0.88 + rnd() * 0.2);
        const shade = 0.82 + rnd() * 0.3;
        stone.add(G.box, M4(sx, gy + h / 2 - 0.15, zWall + (rnd() - 0.5) * 0.16,
          s.tilt, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.03,
          s.w / segs - 0.012, h, 0.62), new THREE.Color(0.68 * shade, 0.66 * shade, 0.60 * shade));
      }
      // capstones
      stone.add(G.box, M4(s.x, gy + s.h * 0.98, zWall, s.tilt, 0, 0, s.w * 0.98, 0.14, 0.78),
        new THREE.Color(0.60, 0.58, 0.53));
      addCollider(s.x, zWall, s.w, 0.9, 'terrace', s.h + 0.35);
      aoBlob(s.x, zWall + 0.4, s.w + 1.0, 1.7);
    }
    // rubble at the gap
    for (let i = 0; i < 7; i++) {
      const x = 0.4 + rr(-1.3, 1.3), z = zWall + rr(-0.9, 0.9);
      stone.add(G.box, M4(x, terrainHeight(x, z) + rr(0.05, 0.3), z,
        rr(0, 3), rr(0, 3), rr(0, 3), rr(0.25, 0.7), rr(0.16, 0.4), rr(0.25, 0.6)),
        new THREE.Color(0.62, 0.60, 0.55));
    }
  }

  /* ------------------------------------------------- 2. colonial arcade */
  {
    const z0 = -28;                 // facade plane
    const W = 38;                   // overall width
    const gy = terrainHeight(0, z0);
    const deck = gy + 0.42;         // walkable top of the stylobate
    const bays = [-13.6, -6.8, 0, 6.8, 13.6];
    const colR = 0.46;
    const capY = deck + 6.15;       // top of the capitals = arch springing
    const span = 3.12;              // arch radius
    const archZ = z0 + 0.2;

    /* --- the building stands on a stepped stylobate, not on the dirt */
    stone.add(G.box, M4(0, gy + 0.10, z0 + 3.6, 0, 0, 0, W + 1.8, 0.20, 10.4), new THREE.Color(0.41, 0.40, 0.36));
    stone.add(G.box, M4(0, gy + 0.31, z0 + 3.3, 0, 0, 0, W + 0.7, 0.22, 9.3), new THREE.Color(0.48, 0.47, 0.42));
    stone.add(G.box, M4(0, deck - 0.05, z0 + 3.1, 0, 0, 0, W, 0.10, 8.5), new THREE.Color(0.57, 0.55, 0.50));
    addCollider(0, z0 + 3.3, W, 9.8, 'stylobate', 0.55, deck);

    // A hollow watchtower anchors the eastern end of the gallery.
    const mason = mulberry32(541);
    const towerX = 15, towerZ = z0 + 5, width = 5.8;
    for (let row = 0; row < 42; row++) {
      for (let face = 0; face < 4; face++) {
        const angle = face * Math.PI / 2;
        let start = -width / 2;
        while (start < width / 2 - 0.01) {
          const length = Math.min(width / 2 - start, 0.65 + mason() * 0.75);
          const center = start + length / 2;
          start += length;
          if (Math.abs(center) < 0.82 && ((row >= 10 && row < 17) || (row >= 27 && row < 34))) continue;
          if (row > 39 && Math.sin(center * 1.4 + face) > 0.4) continue;
          const depth = width / 2 + 0.22 + mason() * 0.04;
          const tone = 0.67 + mason() * 0.20;
          stone.add(G.box, M4(towerX + center * Math.cos(angle) + depth * Math.sin(angle),
            deck + (row + 0.5) * 0.43, towerZ - center * Math.sin(angle) + depth * Math.cos(angle),
            0, angle, (mason() - 0.5) * 0.014, length - 0.012, 0.421, 0.55),
            new THREE.Color(tone, tone * 0.83, tone * 0.65));
        }
      }
    }
    for (const level of [4.28, 11.59]) {
      for (const offset of [-2, 0, 2]) {
        wood.add(G.plank, M4(towerX + offset, deck + level - 0.17, towerZ + 3.85, 0, 0, 0, 0.23, 0.34, 2.5), new THREE.Color(0.46,0.32,0.21));
        wood.add(G.plank, M4(towerX + offset, deck + level - 0.83, towerZ + 3.92, 0.77, 0, 0, 0.18, 2, 0.19), new THREE.Color(0.42,0.29,0.19));
      }
      for (let plank = 0; plank < 9; plank++) {
        wood.add(G.plank, M4(towerX, deck + level + 0.05, towerZ + 3.18 + plank * 0.21, 0, 0, 0, 5.3 + mason() * 0.24, 0.12, 0.198), new THREE.Color(0.56,0.41,0.28));
      }
    }
    addCollider(towerX, towerZ, 6.8, 6.8, 'watchtower', 19);

    /* --- deep shaded interior: a receding vault so the arches read as rooms */
    stone.add(G.box, M4(0, deck + 8.4, z0 - 3.4, 0, 0, 0, W - 0.6, 17.0, 1.6), new THREE.Color(0.105, 0.100, 0.088));
    // side return walls give the interior corners
    for (const sd of [-1, 1]) {
      stone.add(G.box, M4(sd * (W / 2 - 1.4), deck + 4.0, z0 - 2.0, 0, 0, 0, 1.0, 8.0, 5.0),
        new THREE.Color(0.135, 0.128, 0.112));
    }
    // a lit patch deep inside, as if light leaks through the roof
    stone.add(G.box, M4(-2.0, deck + 0.04, z0 - 1.5, 0, 0, 0, W - 2.4, 0.08, 5.6), new THREE.Color(0.30, 0.29, 0.26));
    stone.add(G.box, M4(0, deck + 0.9, z0 - 6.2, 0, 0, 0, W - 2.0, 2.2, 4.0), new THREE.Color(0.16, 0.15, 0.13));
    // fallen masonry inside the dark
    for (let i = 0; i < 22; i++) {
      const px = rr(-16, 16), pz = z0 - rr(0.4, 5.4);
      stone.add(G.box, M4(px, deck + rr(0.05, 0.4), pz, rr(0, 3), rr(0, 3), rr(0, 3),
        rr(0.25, 0.9), rr(0.16, 0.5), rr(0.25, 0.8)),
        new THREE.Color(rr(0.18, 0.32), rr(0.17, 0.30), rr(0.15, 0.27)));
    }
    addCollider(0, z0 - 3.4, W, 1.9, 'backwall', 18);

    /* --- columns: plinth, torus base, tapered shaft, echinus, abacus */
    for (const x of bays) {
      stone.add(G.box, M4(x, deck + 0.09, archZ, 0, 0, 0, 1.34, 0.18, 1.34), new THREE.Color(0.70, 0.68, 0.61));
      stone.add(G.box, M4(x, deck + 0.24, archZ, 0, 0, 0, 1.14, 0.12, 1.14), new THREE.Color(0.74, 0.72, 0.64));
      stone.add(G.torus, M4(x, deck + 0.42, archZ, Math.PI / 2, 0, 0, 1.04, 1.0, 0.92), new THREE.Color(0.77, 0.75, 0.67));
      stone.add(G.cylTaper, M4(x, deck + 0.57 + 2.55, archZ, 0, rr(0, 3), 0, colR * 2, 5.1, colR * 2), new THREE.Color(0.81, 0.79, 0.71));
      stone.add(G.cyl, M4(x, capY - 0.38, archZ, 0, 0, 0, 1.00, 0.10, 1.00), new THREE.Color(0.79, 0.77, 0.69));
      stone.add(G.cylFlare, M4(x, capY - 0.24, archZ, 0, 0, 0, 1.20, 0.22, 1.20), new THREE.Color(0.83, 0.81, 0.73));
      stone.add(G.box, M4(x, capY - 0.06, archZ, 0, 0, 0, 1.30, 0.16, 1.30), new THREE.Color(0.85, 0.83, 0.75));
      addCollider(x, archZ, 1.34, 1.34, 'column', 7.2);
    }

    /* --- arches built from individual voussoirs, with a keystone */
    const N = 13;
    for (let i = 0; i < bays.length - 1; i++) {
      const cx = (bays[i] + bays[i + 1]) / 2;
      if (i === 2) {
        // collapsed bay: a real wall standing from the deck, with a broken top
        // edge — never floating blocks
        const bayW = 6.6;
        const cols = 9;
        const cw = bayW / cols;
        for (let c2 = 0; c2 < cols; c2++) {
          const bx = cx - bayW / 2 + cw * (c2 + 0.5);
          // ragged crest: some columns full height, some broken low
          const crest = 0.30 + Math.pow(Math.abs(Math.sin(c2 * 1.7 + 0.6)), 1.5) * 0.78;
          const hTop = capY + 0.9 - bayW * 0.0 + crest * 3.4;
          const hBot = deck - 0.1;
          const h = hTop - hBot;
          stone.add(G.box, M4(bx + rr(-0.05, 0.05), hBot + h / 2, archZ + rr(-0.04, 0.04),
            rr(-0.02, 0.02), rr(-0.05, 0.05), rr(-0.03, 0.03), cw * 1.03, h, 0.68),
            new THREE.Color(rr(0.56, 0.66), rr(0.55, 0.64), rr(0.49, 0.58)));
          // a few fallen stones resting on the broken crest
          if (crest > 0.72) {
            stone.add(G.box, M4(bx, hTop + 0.10, archZ + rr(-0.06, 0.06),
              0, rr(0, 3), rr(-0.2, 0.2), cw * 0.75, 0.20, 0.60),
              new THREE.Color(rr(0.6, 0.7), rr(0.59, 0.68), rr(0.52, 0.62)));
          }
        }
        continue;
      }
      for (let k = 0; k < N; k++) {
        const a0 = Math.PI * (k / N), a1 = Math.PI * ((k + 1) / N);
        const am = (a0 + a1) / 2;
        const R = span + 0.26;
        const px = cx + Math.cos(am) * R;
        const py = capY + 0.32 + Math.sin(am) * R;
        const wseg = R * (a1 - a0) * 0.94;
        const tone = 0.80 + (k % 2) * 0.022 + rr(-0.02, 0.02);
        stone.add(G.box, M4(px, py, archZ, 0, 0, am - Math.PI / 2, wseg, 0.46, 0.66),
          new THREE.Color(tone, tone * 0.985, tone * 0.90));
      }
      // keystone
      stone.add(G.box, M4(cx, capY + 0.32 + span + 0.26, archZ, 0, 0, 0, 0.48, 0.82, 0.80),
        new THREE.Color(0.88, 0.86, 0.78));
      // spandrel fill up to the entablature
      stone.add(G.box, M4(cx, capY + span + 1.02, archZ, 0, 0, 0, 6.6, 0.55, 0.70),
        new THREE.Color(0.66, 0.64, 0.58));
    }

    /* --- entablature: three architrave bands, dentil frieze, stepped cornice */
    const archTop = capY + span + 1.30;
    for (let i = 0; i < 3; i++) {
      const out = 0.06 * i;
      stone.add(G.box, M4(0, archTop + 0.14 + i * 0.28, z0 + 0.35 + out, 0, 0, 0, W, 0.28, 0.80 + out * 2),
        new THREE.Color(0.72 - i * 0.02, 0.70 - i * 0.02, 0.63 - i * 0.02));
    }
    const friezeY = archTop + 0.98;
    stone.add(G.box, M4(0, friezeY + 0.33, z0 + 0.42, 0, 0, 0, W, 0.66, 0.86), new THREE.Color(0.70, 0.68, 0.61));
    for (let x = -W / 2 + 0.5; x < W / 2 - 0.5; x += 0.36) {
      stone.add(G.box, M4(x, friezeY + 0.08, z0 + 0.78, 0, 0, 0, 0.18, 0.16, 0.18), new THREE.Color(0.76, 0.74, 0.67));
    }
    const corY = friezeY + 0.66;
    stone.add(G.box, M4(0, corY + 0.10, z0 + 0.62, 0, 0, 0, W + 0.3, 0.20, 1.20), new THREE.Color(0.74, 0.72, 0.65));
    stone.add(G.box, M4(0, corY + 0.40, z0 + 0.70, 0, 0, 0, W + 0.5, 0.40, 1.36), new THREE.Color(0.78, 0.76, 0.68));
    stone.add(G.box, M4(0, corY + 0.68, z0 + 0.56, 0, 0, 0, W + 0.4, 0.18, 1.10), new THREE.Color(0.72, 0.70, 0.63));

    /* --- upper storey: wall segments, pilasters, windows, quoins */
    const upperBase = corY + 0.78;
    const wallZ = z0 + 0.42;
    const segs = [
      { x0: -W / 2, x1: -8.7, h: 3.2 },
      { x0: -8.7, x1: 0.4, h: 3.2 },
      { x0: 0.4, x1: 7.4, h: 1.55 },     // collapsed top
      { x0: 7.4, x1: W / 2, h: 3.2 },
    ];
    for (const sg of segs) {
      const w = sg.x1 - sg.x0;
      // rendered wall, with the stone dressings left proud around it
      plaster.add(G.box, M4((sg.x0 + sg.x1) / 2, upperBase + sg.h / 2, wallZ, 0, 0, 0, w, sg.h, 0.72),
        new THREE.Color(0.92, 0.90, 0.82));
      // Islands of failed render expose individual masonry courses below.
      // Their uneven depth catches light and casts small shadows at close range.
      for (let p = 0; p < Math.floor(w * 2.2); p++) {
        const px = rr(sg.x0 + 0.3, sg.x1 - 0.3);
        if (bays.some((bay) => Math.abs(px - bay) < 1.35)) continue;
        const py = upperBase + rr(0.18, sg.h - 0.18);
        const bw = rr(0.14, 0.37);
        const bh = rr(0.07, 0.17);
        stone.add(G.box, M4(px, py, wallZ + 0.374 + rr(-0.012, 0.028),
          0, 0, rr(-0.04, 0.04), bw, bh, 0.045),
          new THREE.Color(rr(0.52, 0.67), rr(0.49, 0.63), rr(0.42, 0.56)));
      }
    }

    for (const x of bays) {
      const collapsed = x > 0.4 && x < 7.4;
      if (!collapsed) {
        const wY = upperBase + 1.62;
        // recess, sill, jambs, lintel, mullion, transom
        stone.add(G.box, M4(x, wY, wallZ + 0.08, 0, 0, 0, 1.74, 2.26, 0.34), new THREE.Color(0.075, 0.078, 0.070));
        stone.add(G.box, M4(x, wY - 1.22, wallZ + 0.34, 0, 0, 0, 2.06, 0.16, 0.52), new THREE.Color(0.78, 0.76, 0.68));
        for (const sd of [-1, 1]) {
          stone.add(G.box, M4(x + sd * 0.95, wY, wallZ + 0.30, 0, 0, 0, 0.20, 2.30, 0.50), new THREE.Color(0.79, 0.77, 0.69));
        }
        stone.add(G.box, M4(x, wY + 1.22, wallZ + 0.30, 0, 0, 0, 2.12, 0.20, 0.50), new THREE.Color(0.79, 0.77, 0.69));
        stone.add(G.box, M4(x, wY, wallZ + 0.20, 0, 0, 0, 0.10, 2.24, 0.18), new THREE.Color(0.66, 0.64, 0.58));
        stone.add(G.box, M4(x, wY + 0.34, wallZ + 0.20, 0, 0, 0, 1.72, 0.09, 0.18), new THREE.Color(0.66, 0.64, 0.58));
      }
      stone.add(G.box, M4(x, upperBase + 1.6, wallZ + 0.42, 0, 0, 0, 0.66, 3.1, 0.34),
        new THREE.Color(0.68, 0.66, 0.60));

      // timber shutters: a pair per window, one always hanging wrong
      if (!collapsed) {
        const wY = upperBase + 1.62;
        for (const sd of [-1, 1]) {
          const open = sd < 0 ? rr(0.5, 1.1) : rr(-0.3, 0.15);
          const hingeX = x + sd * 1.02;
          const sw = 0.94;
          const sag = rnd() > 0.62 ? rr(0.10, 0.30) : 0;
          const sh = 2.16;
          const m4 = M4(hingeX + sd * Math.cos(open) * sw * 0.5,
            wY - sag, wallZ + 0.44 + Math.sin(Math.abs(open)) * sw * 0.42,
            0, sd * open, sd * open * 0.05, sw, sh, 0.07);
          wood.add(G.box, m4, new THREE.Color(0.44, 0.42, 0.34));
          // louvre slats
          for (let sl = 0; sl < 7; sl++) {
            const ly = -sh * 0.42 + sl * (sh * 0.84 / 6);
            wood.add(G.box, m4.clone().multiply(M4(0, ly, 0.03, 0.35, 0, 0, sw * 0.82, 0.075, 0.035)),
              new THREE.Color(0.38, 0.36, 0.29));
          }
          // one broken hinge: the leaf tilts out of the frame
          if (sag > 0) {
            wood.add(G.box, m4.clone().multiply(M4(0.1, -sh * 0.5, 0, 0, 0, 0.3, sw * 0.6, 0.08, 0.06)),
              new THREE.Color(0.34, 0.32, 0.26));
          }
        }
      }
    }

    /* --- a boarded doorway at the foot of the collapsed bay */
    {
      const doorX = 3.4;
      const doorY = deck;
      stone.add(G.box, M4(doorX, doorY + 1.55, archZ + 0.30, 0, 0, 0, 2.5, 0.26, 0.60), new THREE.Color(0.70, 0.68, 0.61));
      for (const sd of [-1, 1]) {
        stone.add(G.box, M4(doorX + sd * 1.2, doorY + 0.78, archZ + 0.30, 0, 0, 0, 0.28, 1.6, 0.56), new THREE.Color(0.68, 0.66, 0.60));
      }
      // hanging planks instead of a door
      for (let i = 0; i < 4; i++) {
        wood.add(G.box, M4(doorX - 0.75 + i * 0.5, doorY + 0.72 + rr(-0.05, 0.05), archZ + 0.42,
          rr(-0.05, 0.05), rr(-0.06, 0.06), rr(-0.12, 0.12), 0.42, rr(1.1, 1.5), 0.08),
          new THREE.Color(rr(0.42, 0.52), rr(0.37, 0.45), rr(0.27, 0.34)));
      }
    }

    // quoins on both corners
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const qy = upperBase + 0.32 + k * 0.52;
        const qw = k % 2 ? 0.62 : 0.82;
        stone.add(G.box, M4(side * (W / 2 - qw / 2 + 0.02), qy, wallZ + 0.40, 0, 0, 0, qw, 0.48, 0.40),
          new THREE.Color(0.72, 0.70, 0.63));
      }
    }

    /* --- upper cornice + parapet with coping and a gap over the ruin */
    const upCor = upperBase + 3.24;
    stone.add(G.box, M4(0, upCor + 0.14, z0 + 0.60, 0, 0, 0, W + 0.4, 0.28, 1.24), new THREE.Color(0.75, 0.73, 0.66));
    stone.add(G.box, M4(0, upCor + 0.44, z0 + 0.68, 0, 0, 0, W + 0.6, 0.32, 1.42), new THREE.Color(0.79, 0.77, 0.69));
    const parY = upCor + 0.62;
    for (const pr of [{ a: -W / 2, b: -0.6 }, { a: 7.6, b: W / 2 }]) {
      const w = pr.b - pr.a;
      stone.add(G.box, M4((pr.a + pr.b) / 2, parY + 0.42, z0 + 0.55, 0, 0, 0, w, 0.84, 0.92), new THREE.Color(0.64, 0.62, 0.56));
      stone.add(G.box, M4((pr.a + pr.b) / 2, parY + 0.92, z0 + 0.55, 0, 0, 0, w + 0.2, 0.16, 1.06), new THREE.Color(0.70, 0.68, 0.61));
      addCollider((pr.a + pr.b) / 2, z0 + 0.55, w, 1.1, 'parapet', 18);
    }

    /* --- interior paving, in front of the arches */
    for (let i = 0; i < 16; i++) {
      const px = rr(-16, 16), pz = z0 + rr(1.0, 5.0);
      stone.add(G.box, M4(px, deck + 0.04, pz, 0, rr(0, 3), 0, rr(1.1, 2.4), 0.08, rr(1.1, 2.2)),
        new THREE.Color(0.40 + rr(-0.05, 0.06), 0.39, 0.36));
    }

    /* --- bell tower, leaning, at the right end */
    const tx = 15.4;
    const ty = upperBase + 0.2;
    plaster.add(G.box, M4(tx, ty + 4.9, z0 - 1.2, 0, 0.05, -0.032, 4.8, 9.8, 4.8), new THREE.Color(0.90, 0.88, 0.79));
    stone.add(G.box, M4(tx + 0.1, ty + 9.95, z0 - 1.2, 0, 0.05, -0.032, 5.4, 0.55, 5.4), new THREE.Color(0.52, 0.51, 0.46));
    for (let k = 0; k < 3; k++) {
      stone.add(G.box, M4(tx, ty + 9.35 - k * 0.42, z0 - 1.2, 0, 0.05, -0.032, 5.1 - k * 0.24, 0.2, 5.1 - k * 0.24),
        new THREE.Color(0.55 - k * 0.02, 0.54 - k * 0.02, 0.48 - k * 0.02));
    }
    stone.add(G.box, M4(tx, ty + 6.1, z0 + 1.24, 0, 0.05, -0.032, 1.5, 2.7, 0.30), new THREE.Color(0.07, 0.072, 0.065));
    stone.add(G.cyl, M4(tx, ty + 6.1 + 1.35, z0 + 1.24, Math.PI / 2, 0, 0, 1.55, 0.34, 0.34), new THREE.Color(0.07, 0.072, 0.065));
    stone.add(G.box, M4(tx, ty + 4.55, z0 + 1.24, 0, 0.05, 0, 1.5, 0.26, 0.26), new THREE.Color(0.72, 0.70, 0.63));
    addCollider(tx, z0 - 1.2, 5.4, 5.4, 'tower', 12);
    aoBlob(tx, z0 - 1.2, 7.0, 7.0);

    /* --- a ruined outbuilding: real rooms, window holes, collapsed roof */
    const ruinedHouse = (hx, hz, rot, HW, HD, HH) => {
      const by = terrainHeight(hx, hz);
      const T = 0.38;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      // author in the house frame, emit into the merged builders
      const put = (b, lx, ly, lz, sx, sy, sz, col, roll = 0) => {
        b.add(G.box, M4(hx + lx * cs - lz * sn, by + ly + sy / 2, hz + lx * sn + lz * cs,
          roll * 0.35, rot, roll, sx, sy, sz), col);
      };
      const render = () => {
        const v = rr(0.82, 0.94);
        return new THREE.Color(v, v * 0.98, v * 0.88);
      };
      // a run of wall between two openings, optionally with a broken crest
      const band = (b, lx0, lx1, ly0, ly1, lz, ragged, col) => {
        const n = Math.max(1, Math.ceil((lx1 - lx0) / 1.15));
        const w = (lx1 - lx0) / n;
        for (let i = 0; i < n; i++) {
          const loss = ragged ? rr(0, 0.9) * Math.min(1, (ly1 - ly0) * 0.6) : 0;
          const h = Math.max(0.22, ly1 - ly0 - loss);
          put(b, lx0 + w * (i + 0.5), ly0, lz, w * 0.995, h, T, col, rr(-0.02, 0.02));
        }
      };

      // floor slab
      stone.add(G.box, M4(hx, by + 0.06, hz, 0, rot, 0, HW + 0.8, 0.12, HD + 0.8),
        new THREE.Color(0.43, 0.42, 0.38));

      const doorW = 0.98, doorH = 2.06;
      const winW = 1.12, winY0 = 1.10, winY1 = 2.40;
      const doorL = -HW * 0.26, winL = HW * 0.24;

      // ---- front wall: door on the left of centre, window to the right
      {
        const fz = HD / 2 - T / 2;
        band(plaster, -HW / 2, doorL - doorW / 2, 0, HH, fz, true, render());
        band(plaster, doorL + doorW / 2, winL - winW / 2, 0, HH, fz, true, render());
        band(plaster, winL + winW / 2, HW / 2, 0, HH, fz, true, render());
        band(plaster, doorL - doorW / 2, doorL + doorW / 2, doorH, HH, fz, false, render());
        band(plaster, winL - winW / 2, winL + winW / 2, 0, winY0, fz, false, render());
        band(plaster, winL - winW / 2, winL + winW / 2, winY1, HH, fz, true, render());
        // stone sill + lintel, timber door frame
        put(stone, winL, winY0 - 0.05, fz + 0.06, winW + 0.24, 0.12, 0.30, new THREE.Color(0.72, 0.70, 0.63));
        put(stone, winL, winY1 + 0.02, fz + 0.06, winW + 0.30, 0.14, 0.28, new THREE.Color(0.70, 0.68, 0.61));
        put(stone, doorL, doorH + 0.02, fz + 0.04, doorW + 0.34, 0.16, 0.26, new THREE.Color(0.68, 0.66, 0.59));
        put(wood, doorL - doorW / 2 - 0.08, 0, fz + 0.02, 0.12, doorH, 0.18, new THREE.Color(0.40, 0.33, 0.24));
        put(wood, doorL + doorW / 2 + 0.08, 0, fz + 0.02, 0.12, doorH, 0.18, new THREE.Color(0.40, 0.33, 0.24));
      }

      // ---- back wall: a hole through to the sky, jagged crest
      {
        const bz = -HD / 2 + T / 2;
        band(plaster, -HW / 2, -HW * 0.12, 0, HH, bz, true, render());
        band(plaster, HW * 0.16, HW / 2, 0, HH, bz, true, render());
        band(plaster, -HW * 0.12, HW * 0.16, 0, HH * 0.42, bz, true, render());
      }

      // ---- side walls, one mostly collapsed
      {
        for (const sd of [-1, 1]) {
          const sx = sd * (HW / 2 - T / 2);
          const keep = sd < 0 ? 1.0 : 0.34;
          band(plaster, -HD / 2, -HD / 2 + HD * 0.3, 0, HH * keep, sx, true, render());
          band(plaster, -HD / 2 + HD * 0.32, HD / 2, 0, HH * keep * rr(0.5, 0.9), sx, true, render());
          // gable stub still standing on the collapsed side
          if (sd > 0) {
            for (let k = 0; k < 3; k++) {
              put(stone, sx, HH * keep + k * 0.34, -HD * 0.2 + k * 0.5, 0.5, 0.34, 0.9,
                new THREE.Color(0.66, 0.64, 0.58), rr(-0.05, 0.05));
            }
          }
        }
      }

      // ---- roof: rafters across the intact half, the rest fallen in
      {
        const rafN = 6;
        for (let i = 0; i < rafN; i++) {
          const lz = -HD / 2 + (i / (rafN - 1)) * HD;
          const y = HH + 0.06;
          if (i < rafN * 0.55) {
            wood.add(G.box, M4(hx - lz * sn, by + y, hz + lz * cs, 0, rot, 0, HW - 0.3, 0.14, 0.16),
              new THREE.Color(rr(0.36, 0.46), rr(0.30, 0.38), rr(0.21, 0.28)));
            // a few surviving roof boards
            if (i % 2 === 0) {
              put(wood, -HW * 0.18, y + 0.10, lz, HW * 0.62, 0.06, 0.5,
                new THREE.Color(0.34, 0.29, 0.21), rr(-0.01, 0.01));
            }
          } else {
            // collapsed: the rafter has dropped and lies tilted
            wood.add(G.box, M4(hx - lz * sn, by + y - rr(0.5, 1.3), hz + lz * cs,
              0, rot, rr(0.25, 0.6), HW - 0.3, 0.13, 0.15),
              new THREE.Color(0.32, 0.27, 0.19));
          }
        }
        // ridge beam, snapped in two
        wood.add(G.box, M4(hx + HW * 0.16 * cs, by + HH + 0.22, hz + HW * 0.16 * sn, 0, rot, 0, HW * 0.66, 0.18, 0.20),
          new THREE.Color(0.36, 0.30, 0.21));
      }

      // ---- fallen masonry piled against the base
      for (let i = 0; i < 14; i++) {
        const lx = rr(-HW / 2, HW / 2), lz = rr(-HD / 2, HD / 2);
        if (Math.abs(lx) < HW / 2 - 0.5 && Math.abs(lz) < HD / 2 - 0.5) continue;
        stone.add(G.box, M4(hx + lx * cs - lz * sn, by + rr(0.05, 0.28), hz + lx * sn + lz * cs,
          rr(0, 3), rr(0, 3), rr(0, 3), rr(0.22, 0.6), rr(0.14, 0.34), rr(0.22, 0.55)),
          new THREE.Color(rr(0.56, 0.68), rr(0.55, 0.66), rr(0.49, 0.60)));
      }

      // dark interior so the openings read as depth, not paint
      stone.add(G.box, M4(hx, by + HH / 2, hz, 0, rot, 0, HW - 0.9, HH - 0.55, HD - 1.0),
        new THREE.Color(0.055, 0.057, 0.050));

      addCollider(hx, hz, HW + 0.6, HD + 0.6, 'house', HH + 0.4);
      aoBlob(hx, hz, HW + 1.6, HD + 1.6);
    };

    ruinedHouse(-24.5, -18.0, 0.28, 6.4, 5.2, 3.5);
    ruinedHouse(-21.0, -9.5, -0.42, 4.4, 4.0, 2.9);

    /* --- a fallen column lying in the yard */
    const fx = -1.5, fz = -19;
    const fy = terrainHeight(fx, fz);
    for (let k = 0; k < 5; k++) {
      stone.add(G.cyl, M4(fx - 2.8 + k * 1.4, fy + 0.45, fz + rr(-0.06, 0.06),
        0, 0, Math.PI / 2 - 0.05, 0.92, 1.38, 0.92), new THREE.Color(0.73 - k * 0.01, 0.71 - k * 0.01, 0.64));
    }
    addCollider(fx, fz, 7, 1.1, 'fallen', 1.0);
    aoBlob(fx, fz, 8.2, 2.0);

    /* --- low plinth + votive statue */
    const sx = 6.6, sz = -17.5;
    const sy = terrainHeight(sx, sz);
    stone.add(G.box, M4(sx, sy + 0.16, sz, 0, 0.2, 0, 2.5, 0.32, 2.5), new THREE.Color(0.62, 0.60, 0.54));
    stone.add(G.box, M4(sx, sy + 0.52, sz, 0, 0.2, 0, 2.2, 0.40, 2.2), new THREE.Color(0.64, 0.62, 0.56));
    stone.add(G.box, M4(sx, sy + 0.86, sz, 0, 0.2, 0, 1.95, 0.28, 1.95), new THREE.Color(0.66, 0.64, 0.58));
    const figY = sy + 1.0;
    stone.add(G.cylTaper, M4(sx, figY + 0.82, sz, 0, 0.2, 0.02, 0.86, 1.65, 0.72), new THREE.Color(0.67, 0.65, 0.59));
    stone.add(G.sph, M4(sx, figY + 1.92, sz, 0, 0, 0, 0.60, 0.70, 0.60), new THREE.Color(0.69, 0.67, 0.61));
    stone.add(G.box, M4(sx, figY + 1.42, sz + 0.34, 0.5, 0, 0, 0.15, 1.45, 0.15), new THREE.Color(0.63, 0.61, 0.56));
    addCollider(sx, sz, 2.6, 2.6, 'statue', 3.2);
    aoBlob(sx, sz, 3.8, 3.8);
  }

  /* --------------------------------------------------- 3. the debris yard */
  const barrel = (x, z, lying = false, sc = 1) => {
    const y = terrainHeight(x, z);
    const seed = Math.round(Math.abs(x * 73856093 + z * 19349663)) % 100000;
    const r = mulberry32(seed);

    // staves: every barrel gets its own bulge profile
    const profile = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const belly = 0.062 * Math.sin(t * Math.PI) * (0.6 + r() * 0.8);
      profile.push([0.335 + belly * (0.84 + r() * 0.26), t]);
    }
    const geo = new THREE.LatheGeometry(profile.map(([rad, tt]) => new THREE.Vector2(rad, tt)), 12);

    const m = lying
      ? M4(x, y + 0.34 * sc, z, Math.PI / 2, rr(0, 3), rr(-0.36, 0.36), sc, sc, sc)
      : M4(x, y + 0.42 * sc, z, rr(-0.09, 0.09), rr(0, 3), rr(-0.09, 0.09), sc, sc, sc);

    const tone = 0.52 + (r() - 0.5) * 0.12;
    wood.add(geo, m, new THREE.Color(tone, tone * 0.74, tone * 0.48));

    // hoops drift from barrel to barrel
    for (const h of [-0.30, 0.02, 0.32]) {
      const hh = h + (r() - 0.5) * 0.05;
      const w = 0.062 + r() * 0.045;
      const mm = m.clone().multiply(M4(0, hh * sc, 0, 0, 0, 0, 1.08, w / 0.9, 1.08));
      metal.add(G.cyl, mm, new THREE.Color(0.42 + (r() - 0.5) * 0.10, 0.35, 0.28));
    }
    addCollider(x, z, 0.85 * sc, 0.85 * sc, 'barrel', 0.95 * sc);
    aoBlob(x, z, 1.8 * sc, 1.8 * sc);
  };

  const crate = (x, z, s = 1) => {
    const y = terrainHeight(x, z);
    const seed = Math.round(Math.abs(x * 73856093 + z * 19349663 + 7)) % 100000;
    const r = mulberry32(seed);
    const sx = 0.72 * s * (0.80 + r() * 0.38);
    const sy = 0.62 * s * (0.80 + r() * 0.40);
    const sz = 0.72 * s * (0.80 + r() * 0.38);
    const tone = 0.60 + (r() - 0.5) * 0.13;
    const rot = M4(x, y + sy / 2, z, rr(-0.10, 0.10), rr(0, 3), rr(-0.10, 0.10), sx, sy, sz);
    wood.add(G.box, rot, new THREE.Color(tone, tone * 0.78, tone * 0.50));
    // a shifted lid board so no two crates close the same way
    wood.add(G.box, rot.clone().multiply(M4(rr(-0.1, 0.1), 0.5, 0, 0, 0, rr(-0.1, 0.1), 1.04, 0.07, 1.04)),
      new THREE.Color(tone * 0.84, tone * 0.66, tone * 0.44));
    addCollider(x, z, 0.8 * s, 0.8 * s, 'crate', 0.72 * s);
    aoBlob(x, z, 1.6 * s, 1.6 * s);
  };

  const wheel = (x, y, z, r = 0.46, rot = 0) => {
    wood.add(new THREE.TorusGeometry(r, 0.07, 6, 18), M4(x, y, z, rot, rr(0, 3), 0),
      new THREE.Color(0.48, 0.35, 0.22));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      wood.add(G.box, M4(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, z,
        0, 0, a, r * 0.95, 0.055, 0.055), new THREE.Color(0.44, 0.32, 0.20));
    }
  };

  const cart = (x, z, rot = 0.4) => {
    const y = terrainHeight(x, z);
    const m = M4(x, y + 0.5, z, 0.10, rot, 0.16);
    wood.add(G.box, m.clone().multiply(M4(0, 0, 0, 0, 0, 0, 1.9, 0.14, 1.05)),
      new THREE.Color(0.55, 0.41, 0.26));
    for (const s of [-1, 1]) {
      wood.add(G.box, m.clone().multiply(M4(s * 0.92, 0.18, 0, 0, 0, 0, 0.1, 0.34, 1.02)),
        new THREE.Color(0.50, 0.37, 0.23));
    }
    wood.add(G.box, m.clone().multiply(M4(0.0, 0.2, -0.5, 0, 0, 0, 1.86, 0.34, 0.1)),
      new THREE.Color(0.50, 0.37, 0.23));
    // shafts
    wood.add(G.box, m.clone().multiply(M4(1.5, 0.06, 0.28, 0.06, 0, 0, 1.5, 0.08, 0.08)),
      new THREE.Color(0.46, 0.34, 0.21));
    addCollider(x, z, 2.2, 1.4, 'cart', 1.2);
    aoBlob(x, z, 3.2, 2.4);
    const wy = y + 0.62;
    wheel(x + Math.cos(rot) * 0.9 - Math.sin(rot) * 0.55, wy, z + Math.sin(rot) * 0.9 + Math.cos(rot) * 0.55, 0.5, 0.16);
    wheel(x + Math.cos(rot) * 0.9 - Math.sin(rot) * -0.55, wy, z + Math.sin(rot) * 0.9 + Math.cos(rot) * -0.55, 0.5, 0.16);
  };

  const flag = (x, y, z, w, h, rotY, tex) => {
    // a cloth grid won't read as fabric if every vertex sits on a flat plane:
    // bake deep folds, a slack sag and a torn silhouette into the geometry
    const g = new THREE.PlaneGeometry(1, h, 24, 16);
    g.translate(0.5, 0, 0);
    const pos = g.attributes.position;
    const rF = mulberry32((Math.round((x + z) * 977) + 7) & 0xffff);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);                     // 0 at the staff, 1 at the fly
      const v = pos.getY(i) / h + 0.5;           // 0 bottom, 1 top
      // deep vertical folds that get deeper toward the free edge
      const fold = Math.sin(u * Math.PI * 3.1 + v * 1.4) * w * 0.075 * Math.pow(u, 1.2);
      // the whole sheet sags and twists when it is not held taut
      const sag = Math.sin(u * Math.PI) * h * 0.075;
      const twist = Math.sin(u * Math.PI * 1.9 + 0.6) * 0.20 * u;
      // torn hem: the bottom edge wanders, the fly edge is chewed
      const hemTear = Math.pow(v, 3.0) * h * (0.05 + rF() * 0.10) * u;
      const flyTear = Math.pow(u, 6.0) * w * (0.05 + rF() * 0.12);
      pos.setXYZ(i,
        u * w - flyTear,
        pos.getY(i) - sag - u * h * 0.05 + hemTear,
        fold + twist * w * 0.05);
    }
    g.computeVertexNormals();

    const b = new GeoBuilder();
    b.add(g, M4(0, 0, 0, 0, 0, 0, 1, 1, 1), new THREE.Color(1, 1, 1), (yy) =>
      clamp((yy + h / 2) / h, 0, 1));
    const geo = b.build();
    const mat = clothMatBase.clone();
    mat.map = tex;
    clothify(mat, { speed: 2.9, amp: 0.20, wavelength: 1.3, billow: 1.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // the staff rope the cloth is lashed to
    flags.push(mesh);
    return mesh;
  };

  {
    // tangle of junk around the yard centre, matching the reference composition
    barrel(-2.6, -8.4, false, 1.0);
    barrel(-1.5, -9.6, true, 0.95);
    barrel(-3.9, -7.2, false, 0.85);
    barrel(3.2, -10.5, false, 1.05);
    barrel(4.4, -9.2, true, 0.9);
    crate(-4.8, -11.2, 1.0);
    crate(-5.4, -10.4, 0.8);
    crate(2.2, -7.6, 0.9);
    crate(5.6, -12.4, 1.05);
    cart(-0.4, -11.6, 0.6);
    cart(6.9, -14.2, -0.9);
    wheel(1.2, terrainHeight(1.2, -12.8) + 0.46, -12.8, 0.5, 0.2);
    wheel(-6.2, terrainHeight(-6.2, -8.0) + 0.44, -8.0, 0.48, -0.1);

    // fallen mast with rigging and tattered sails
    {
      const mx = -6.5, mz = -14.5;
      const my = terrainHeight(mx, mz);
      wood.add(G.cyl, M4(mx, my + 2.6, mz, 0.22, 0, 0.34, 0.34, 7.4, 0.34),
        new THREE.Color(0.42, 0.31, 0.20));
      wood.add(G.cyl, M4(mx + 0.7, my + 4.2, mz + 0.35, 0, 0.2, Math.PI / 2 - 0.35, 0.2, 4.6, 0.2),
        new THREE.Color(0.40, 0.30, 0.19));
      addCollider(mx, mz, 1.2, 1.2, 'mast', 8);
      aoBlob(mx, mz, 2.6, 2.6);
      const f1 = flag(mx + 1.4, my + 4.0, mz + 0.5, 2.6, 1.7, -0.5, flagTexture('#8d2b22', '#c9a24a'));
      const f2 = flag(mx + 1.2, my + 3.1, mz + 0.4, 2.0, 1.3, -0.5, flagTexture('#7b2b26', '#b9973f'));
    }

    // banner poles
    for (let i = 0; i < 5; i++) {
      const px = -8.5 + i * 3.6 + rr(-0.7, 0.7);
      const pz = -6.2 + rr(-1.6, 1.6);
      const py = terrainHeight(px, pz);
      const h = rr(2.4, 3.6);
      wood.add(G.cyl, M4(px, py + h / 2, pz, rr(-0.12, 0.12), 0, rr(-0.12, 0.12), 0.09, h, 0.09),
        new THREE.Color(0.40, 0.30, 0.19));
      if (i % 2 === 0) {
        flag(px + 0.45, py + h - 0.55, pz, rr(1.0, 1.6), rr(0.7, 1.1), rr(-0.8, 0.8),
          flagTexture(i % 3 === 0 ? '#8d2b22' : '#6d2a24', '#c9a24a'));
      }
    }

    // overturned hull
    {
      const bx = 8.6, bz = -7.4;
      const by = terrainHeight(bx, bz);
      wood.add(G.sph, M4(bx, by + 0.25, bz, 0, 0.7, 0.16, 3.4, 1.1, 1.3),
        new THREE.Color(0.42, 0.33, 0.24));
      for (let i = 0; i < 5; i++) {
        wood.add(G.box, M4(bx - 1.2 + i * 0.6, by + 0.55, bz, 0.1, 0.7, 0, 0.08, 0.45, 1.5),
          new THREE.Color(0.38, 0.30, 0.21));
      }
      addCollider(bx, bz, 3.0, 1.6, 'hull', 1.2);
      aoBlob(bx, bz, 4.2, 2.4);
    }

    // rusty machinery bits
    for (let i = 0; i < 8; i++) {
      const px = rr(-9, 10), pz = rr(-16, -6);
      const py = terrainHeight(px, pz);
      metal.add(G.box, M4(px, py + rr(0.1, 0.45), pz, rr(0, 3), rr(0, 3), rr(0, 3),
        rr(0.2, 0.7), rr(0.12, 0.4), rr(0.2, 0.6)), new THREE.Color(0.46, 0.34, 0.26));
    }

    // foreground barrels near the wall (like the reference)
    barrel(4.2, 5.2, false, 1.15);
    barrel(5.3, 5.6, false, 0.95);
    barrel(4.7, 6.1, true, 0.9);
    barrel(-8.2, 5.6, false, 1.0);
  }

  /* --------------------------------------------------- 4. path kerbstones */
  {
    for (let z = 12; z > -18; z -= 1.9) {
      const cx = Math.sin((z + 12) * 0.085) * 3.6 + Math.sin((z + 3) * 0.21) * 0.9;
      for (const side of [-1, 1]) {
        if (rnd() > 0.72) continue;
        const x = cx + side * rr(2.0, 2.9);
        const y = terrainHeight(x, z);
        stone.add(G.box, M4(x, y + 0.06, z + rr(-0.4, 0.4), rr(-0.1, 0.1), rr(0, 3), rr(-0.1, 0.1),
          rr(0.5, 1.1), rr(0.14, 0.24), rr(0.4, 0.8)), new THREE.Color(0.56, 0.54, 0.49));
      }
    }
  }

  /* ------------------------------------------------------ 5. build meshes */
  function brighten(geo, k) {
    const c = geo.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }

  const stoneGeo = stone.build();
  mossPass(stoneGeo, 0.30);
  weatherPass(stoneGeo, 0.28);
  brighten(stoneGeo, 1.42);
  const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat);
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  scene.add(stoneMesh);

  const woodGeo = wood.build();
  mossPass(woodGeo, 0.34);
  weatherPass(woodGeo, 0.30);
  brighten(woodGeo, 1.62);
  const woodMesh = new THREE.Mesh(woodGeo, woodMat);
  woodMesh.castShadow = true;
  woodMesh.receiveShadow = true;
  scene.add(woodMesh);

  const plasterGeo = plaster.build();
  mossPass(plasterGeo, 0.26);
  weatherPass(plasterGeo, 0.22);
  const plasterMesh = new THREE.Mesh(plasterGeo, plasterMat);
  plasterMesh.castShadow = true;
  plasterMesh.receiveShadow = true;
  scene.add(plasterMesh);

  const metalGeo = metal.build();
  weatherPass(metalGeo, 0.34);
  brighten(metalGeo, 1.15);
  const metalMesh = new THREE.Mesh(metalGeo, metalMat);
  metalMesh.castShadow = true;
  metalMesh.receiveShadow = true;
  scene.add(metalMesh);

  // baked-AO footprints: darken the ground where objects meet it
  {
    const inst = new THREE.InstancedMesh(aoGeo, aoMat, Math.max(1, aoBlobs.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let i = 0; i < aoBlobs.length; i++) {
      const b = aoBlobs[i];
      pv.set(b.x, terrainHeight(b.x, b.z) + b.yOff, b.z);
      q.setFromEuler(new THREE.Euler(0, rr(0, 6.28), 0));
      sc.set(b.sx, 1, b.sz);
      m.compose(pv, q, sc);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.renderOrder = 1;
    inst.frustumCulled = false;
    scene.add(inst);
  }

  /* ------------------------------------------------------- 6. wall vines */
  {
    const vineMat = new THREE.MeshStandardMaterial({
      map: vineTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.9, metalness: 0, vertexColors: true,
    });
    windify(vineMat, 0.035, 0.9);

    // strands hang from the cornice and root in the stylobate, flush to the facade
    const facadeZ = -27.16;          // just proud of the wall face
    const gy = terrainHeight(0, -28);
    const deck = gy + 0.42;
    const clumps = [
      { x: -15.2, spread: 2.6, top: 9.0 }, { x: -9.4, spread: 2.0, top: 7.4 },
      { x: -3.0, spread: 2.6, top: 8.6 }, { x: 3.1, spread: 2.2, top: 6.8 },
      { x: 9.0, spread: 2.8, top: 8.2 }, { x: 14.6, spread: 2.2, top: 6.4 },
      { x: -17.8, spread: 1.4, top: 5.6 }, { x: 17.4, spread: 1.2, top: 5.2 },
    ];

    const strandGeo = new THREE.PlaneGeometry(0.9, 1.0, 1, 8);
    // taper the ends so a strand reads as a hanging vine, not a rectangle
    {
      const pos = strandGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const yy = pos.getY(i) + 0.5;                 // 0 bottom .. 1 top
        pos.setX(i, pos.getX(i) * (0.35 + yy * 0.85));
        pos.setZ(i, Math.sin(yy * 2.2) * 0.05);
      }
      strandGeo.computeVertexNormals();
    }

    const b = new GeoBuilder();
    for (let i = 0; i < 150; i++) {
      const c = clumps[i % clumps.length];
      // hang from a point, drooping downward with a slight sway
      const rootX = c.x + rr(-c.spread, c.spread);
      const rootY = deck + rr(c.top * 0.42, c.top);
      const len = rr(0.9, 3.6);
      const sc = rr(0.7, 1.25);
      b.add(strandGeo,
        M4(rootX, rootY - len * 0.5, facadeZ + rr(0.01, 0.05),
          rr(-0.10, 0.10), rr(-0.08, 0.08), rr(-0.14, 0.14), sc, len * sc * 0.9, sc),
        new THREE.Color(rr(0.78, 1.0), rr(0.86, 1.08), rr(0.7, 0.9)),
        (yy) => clamp(1 - (yy + 0.5), 0, 1) * 0.9);
    }
    // a few rooted runners climbing the wall from the deck
    for (let i = 0; i < 46; i++) {
      const c = clumps[i % clumps.length];
      const x = c.x + rr(-c.spread, c.spread);
      const climb = rr(0.8, 3.2);
      b.add(strandGeo,
        M4(x, deck + climb * 0.5, facadeZ + 0.03,
          0.04, rr(-0.1, 0.1), rr(-0.1, 0.1), rr(0.7, 1.1), climb * rr(0.7, 1.1), 1),
        new THREE.Color(rr(0.72, 0.94), rr(0.8, 1.0), rr(0.62, 0.84)),
        (yy) => clamp((yy + 0.5) * 0.8, 0, 1));
    }

    const vm = new THREE.Mesh(b.build(), vineMat);
    vm.receiveShadow = true;
    scene.add(vm);

    // corner columns get a wrap of ivy as well
    const cb = new GeoBuilder();
    const wrap = new THREE.PlaneGeometry(1.4, 0.9, 3, 1);
    {
      const pos = wrap.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const xx = pos.getX(i) * 2;
        pos.setZ(i, Math.cos(xx * 1.4) * 0.34);
      }
      wrap.computeVertexNormals();
    }
    for (let i = 0; i < 30; i++) {
      const side = i % 2 ? 1 : -1;
      const y = deck + rr(0.8, 5.4);
      cb.add(wrap, M4(side * 18.6, y, archFaceZ(), 0, side * Math.PI / 2, rr(-0.2, 0.2), 1, 1, 1),
        new THREE.Color(rr(0.7, 0.95), rr(0.8, 1.02), rr(0.62, 0.86)), 1.0);
    }
    const cm = new THREE.Mesh(cb.build(), vineMat);
    cm.receiveShadow = true;
    scene.add(cm);

    function archFaceZ() { return -26.9; }
  }

  /* ------------------------------------------------------- 7. interactables */
  {
    // chest
    const cx = -3.2, cz = -9.0;
    const cy = terrainHeight(cx, cz);
    const chest = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ map: woodS.map, normalMap: woodS.normal,
      color: 0x8d6745, roughness: 0.93, metalness: 0 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x211b16, roughness: 0.96 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x554b3d, roughness: 0.68, metalness: 0.72 });
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x62402a, roughness: 0.96, metalness: 0.22 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xa48043, roughness: 0.48, metalness: 0.78 });
    const part = (parent, geo, mat, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z); mesh.rotation.x = rx;
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      return mesh;
    };
    // Separate warped boards leave real seams and silhouettes instead of a painted box.
    part(chest, new THREE.BoxGeometry(0.92, 0.055, 0.64), edgeMat, 0, 0.035, 0);
    for (const face of [-1, 1]) {
      for (let row = 0; row < 4; row++) {
        const h = 0.105 + (row % 2) * 0.012;
        part(chest, new THREE.BoxGeometry(0.88, h, 0.037), bodyMat,
          0, 0.095 + row * 0.11, face * 0.295);
      }
      for (const x of [-0.425, 0.425])
        part(chest, new THREE.BoxGeometry(0.038, 0.43, 0.045), ironMat, x, 0.27, face * 0.311);
    }
    for (const face of [-1, 1]) {
      for (let row = 0; row < 4; row++)
        part(chest, new THREE.BoxGeometry(0.035, 0.105, 0.55), bodyMat,
          face * 0.447, 0.095 + row * 0.11, 0);
    }
    const lid = new THREE.Group();
    lid.position.set(0, 0.5, -0.29); chest.add(lid);
    const arc = 9;
    for (let i = 0; i < arc; i++) {
      const a = Math.PI * (i + 0.5) / arc;
      const z = 0.29 - Math.cos(a) * 0.29;
      const y = 0.005 + Math.sin(a) * 0.16;
      part(lid, new THREE.BoxGeometry(0.88, 0.047, 0.105), bodyMat,
        0, y, z, (Math.PI / 2 - a) * 0.48);
      for (const x of [-0.30, 0.30]) {
        part(lid, new THREE.BoxGeometry(0.073, 0.022, 0.108), ironMat,
          x, y + 0.032, z, (Math.PI / 2 - a) * 0.48);
        if (i % 2 === 0) part(lid, new THREE.SphereGeometry(0.012, 6, 4), rustMat,
          x, y + 0.052, z);
      }
    }
    for (const x of [-0.30, 0.30]) {
      part(chest, new THREE.BoxGeometry(0.075, 0.47, 0.035), ironMat, x, 0.27, 0.32);
      for (const y of [0.12, 0.31, 0.45])
        part(chest, new THREE.SphereGeometry(0.013, 6, 4), rustMat, x, y, 0.346);
      part(chest, new THREE.BoxGeometry(0.09, 0.065, 0.07), ironMat, x, 0.5, -0.31);
    }
    part(chest, new THREE.BoxGeometry(0.16, 0.19, 0.045), brassMat, 0, 0.39, 0.342);
    part(chest, new THREE.TorusGeometry(0.027, 0.006, 6, 12), edgeMat, 0, 0.38, 0.37);
    for (const x of [-0.36, 0.36]) {
      part(chest, new THREE.TorusGeometry(0.075, 0.012, 6, 16), ironMat, x, 0.28, 0);
    }
    const glow = new THREE.PointLight(0xffce7a, 0, 3.2, 2);
    glow.position.set(0, 0.7, 0);
    chest.add(glow);
    chest.position.set(cx, cy, cz);
    chest.rotation.y = 0.5;
    scene.add(chest);
    interactables.push({
      id: 'chest', type: 'chest', label: '打开遗留的木箱', pos: new THREE.Vector3(cx, cy + 0.2, cz),
      radius: 2.2, object: chest, lid, glow, taken: false,
    });

    // note on the terrace wall
    const nx = 8.4, nz = 3.4;
    const ny = terrainHeight(nx, nz) + 1.2;
    const noteMat = new THREE.MeshStandardMaterial({
      color: 0xe8dcbd, roughness: 0.9, side: THREE.DoubleSide,
      emissive: new THREE.Color(0x6b4a1e), emissiveIntensity: 0.9,
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.38), noteMat);
    note.position.set(nx - 0.2, ny, nz + 0.33);
    note.rotation.set(-0.1, 0.2, 0.06);
    scene.add(note);
    interactables.push({
      id: 'note', type: 'note', label: '阅读便条', pos: new THREE.Vector3(nx - 0.2, ny, nz + 0.4),
      radius: 2.8, object: note, taken: false,
    });

    // stone tablet inside the arcade
    const tx = 2.0, tz = -27.0;
    const ty = terrainHeight(tx, tz) + 0.42;   // stands on the stylobate
    const tabMat = new THREE.MeshStandardMaterial({ color: 0x6f6a5c, roughness: 0.9 });
    const tablet = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.3), tabMat);
    tablet.position.set(tx, ty + 0.9, tz);
    tablet.rotation.set(-0.12, 0.1, 0.03);
    tablet.castShadow = true; tablet.receiveShadow = true;
    scene.add(tablet);
    interactables.push({
      id: 'tablet', type: 'tablet', label: '查看刻文石板', pos: new THREE.Vector3(tx, ty + 0.9, tz),
      radius: 2.2, object: tablet, taken: false,
    });
  }

  return {
    colliders, interactables, flags,
    update(t) {
      for (const f of flags) f.rotation.z = Math.sin(t * 2.1 + f.position.x) * 0.03;
    },
  };
}
