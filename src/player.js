import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, smoothstep, mulberry32, normalFromCanvas } from './util.js';
import { terrainHeight } from './env.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const UP = new THREE.Vector3(0, 1, 0);

function mat(color, rough = 0.85, metal = 0, extra) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, ...(extra || {}),
  });
}

/* woven cloth: a fine warp/weft normal map stops fabric reading as plastic */
function weaveCanvas(seed) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  g.lineWidth = 1;
  for (let i = 0; i < S; i += 3) {
    const v = 128 + (r() - 0.5) * 46;
    g.strokeStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, S); g.stroke();
    const w = 128 + (r() - 0.5) * 46;
    g.strokeStyle = `rgb(${w | 0},${w | 0},${w | 0})`;
    g.beginPath(); g.moveTo(0, i + 1.5); g.lineTo(S, i + 1.5); g.stroke();
  }
  for (let i = 0; i < 300; i++) {
    const v = 128 + (r() - 0.5) * 104;
    g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.5)`;
    g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 2);
  }
  return c;
}

/* surface of revolution from [radius, y] pairs — organic limbs, not boxes */
function lathe(profile, segments = 20) {
  return new THREE.LatheGeometry(profile.map(([rr, yy]) => new THREE.Vector2(rr, yy)), segments);
}

function buildCharacter() {
  const root = new THREE.Group();

  const weave = normalFromCanvas(weaveCanvas(7), 1.0);
  weave.repeat.set(3, 3);
  const weaveFine = weave.clone();
  weaveFine.needsUpdate = true;
  weaveFine.repeat.set(6, 6);

  const skin = mat(0xc08a63, 0.6);
  const skinShade = mat(0xac7a55, 0.66);
  const shirt = mat(0x8d8467, 0.93, 0, { normalMap: weave, normalScale: new THREE.Vector2(0.5, 0.5) });
  const shirtDark = mat(0x6f6850, 0.95, 0, { normalMap: weave });
  const pants = mat(0x4a4938, 0.96, 0, { normalMap: weave, normalScale: new THREE.Vector2(0.7, 0.7) });
  const bootMat = mat(0x2c221a, 0.72, 0, { normalMap: weaveFine, normalScale: new THREE.Vector2(0.4, 0.4) });
  const soleMat = mat(0x18120e, 0.85);
  const leather = mat(0x5b4128, 0.62);
  const brass = mat(0xb59a58, 0.35, 0.8);
  const hairMat = mat(0x2a2019, 0.95);

  const add = (geo, material, parent, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ---------------------------------------------------------- hips */
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);

  const pelvis = new THREE.Mesh(lathe([
    [0.128, -0.13], [0.156, -0.08], [0.164, 0.00], [0.150, 0.08],
  ], 20), pants);
  pelvis.scale.z = 0.80;
  pelvis.castShadow = true;
  hips.add(pelvis);

  /* --------------------------------------------------------- torso */
  const torso = new THREE.Group();
  torso.position.y = 0.05;
  hips.add(torso);

  const chest = new THREE.Mesh(lathe([
    [0.146, 0.00], [0.150, 0.07], [0.158, 0.17], [0.180, 0.29],
    [0.194, 0.37], [0.186, 0.44], [0.152, 0.50], [0.098, 0.545],
  ], 24), shirt);
  chest.scale.z = 0.76;
  chest.castShadow = true;
  chest.receiveShadow = true;
  torso.add(chest);

  // belt + buckle
  const beltGeo = new THREE.TorusGeometry(0.152, 0.020, 6, 24);
  const belt = add(beltGeo, leather, torso, 0, 0.02, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.z = 0.80;
  add(new THREE.BoxGeometry(0.052, 0.044, 0.016), brass, torso, 0, 0.02, 0.122);

  // shoulder yoke / collar
  const collar = add(new THREE.TorusGeometry(0.075, 0.020, 6, 18), shirtDark, torso, 0, 0.525, 0);
  collar.rotation.x = Math.PI / 2;

  // satchel strap + bag (reads as gear without adding polys to the body)
  const strap = add(new THREE.BoxGeometry(0.048, 0.60, 0.020), leather, torso, 0.055, 0.28, 0.112);
  strap.rotation.z = -0.36;
  strap.rotation.x = 0.12;
  const bag = add(new THREE.BoxGeometry(0.17, 0.15, 0.085), leather, torso, -0.135, 0.06, 0.085);
  bag.rotation.y = 0.25;

  /* ---------------------------------------------------- neck + head */
  add(new THREE.CylinderGeometry(0.050, 0.055, 0.10, 14), skin, torso, 0, 0.575, 0);

  const head = new THREE.Group();
  head.position.y = 0.625;
  torso.add(head);

  const skull = add(new THREE.SphereGeometry(0.099, 26, 20), skin, head, 0, 0.035, 0);
  skull.scale.set(0.97, 1.09, 1.02);

  const jaw = add(new THREE.SphereGeometry(0.077, 20, 16), skin, head, 0, -0.030, -0.012);
  jaw.scale.set(0.94, 0.86, 0.99);

  // brow ridge, nose, cheekbones, ears
  const brow = add(new THREE.BoxGeometry(0.134, 0.021, 0.028), skinShade, head, 0, 0.056, -0.086);
  brow.rotation.x = -0.22;
  const nose = add(new THREE.SphereGeometry(0.021, 12, 10), skin, head, 0, 0.002, -0.100);
  nose.scale.set(0.85, 1.55, 1.15);
  for (const s of [-1, 1]) {
    const cheek = add(new THREE.SphereGeometry(0.033, 12, 10), skin, head, s * 0.062, -0.012, -0.052);
    cheek.scale.set(1.0, 0.8, 0.7);
    const ear = add(new THREE.SphereGeometry(0.027, 12, 10), skin, head, s * 0.094, 0.010, -0.006);
    ear.scale.set(0.42, 1.15, 0.85);
  }

  const hairCap = add(new THREE.SphereGeometry(0.1025, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat, head, 0, 0.032, -0.004);
  hairCap.scale.set(1.0, 1.07, 1.03);
  for (let i = 0; i < 6; i++) {
    const tuft = add(new THREE.SphereGeometry(0.026, 8, 6), hairMat, head, (i - 2.5) * 0.030, 0.082, -0.058);
    tuft.scale.set(1.0, 0.62, 0.85);
  }

  /* ------------------------------------------------------ explorer hat */
  const hat = new THREE.Group();
  hat.position.y = 0.108;
  hat.rotation.x = -0.05;
  head.add(hat);
  const brim = new THREE.Mesh(lathe([
    [0.028, 0.000], [0.120, 0.006], [0.176, 0.022], [0.196, 0.038],
    [0.196, 0.048], [0.176, 0.040], [0.120, 0.026], [0.028, 0.020],
  ], 28), mat(0x6b5537, 0.95));
  brim.castShadow = true;
  hat.add(brim);
  add(new THREE.CylinderGeometry(0.092, 0.106, 0.118, 22, 1), mat(0x745d3c, 0.95), hat, 0, 0.072, 0);
  const band = add(new THREE.TorusGeometry(0.102, 0.011, 6, 22), mat(0x3a2c1c, 0.9), hat, 0, 0.032, 0);
  band.rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.092, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(0x745d3c, 0.95), hat, 0, 0.130, 0).scale.set(1, 0.25, 1);

  /* ------------------------------------------------------- arms */
  const arms = {};
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.172, 0.452, 0);
    torso.add(shoulder);

    add(new THREE.SphereGeometry(0.062, 16, 12), shirt, shoulder, 0, 0, 0).scale.set(1, 0.94, 1);

    const upper = new THREE.Mesh(lathe([
      [0.056, -0.300], [0.060, -0.170], [0.068, -0.050], [0.072, 0.020],
    ], 16), shirt);
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.300;
    shoulder.add(elbow);
    add(new THREE.SphereGeometry(0.048, 14, 10), skin, elbow, 0, 0, 0).scale.set(1, 1, 0.92);

    const fore = new THREE.Mesh(lathe([
      [0.038, -0.255], [0.044, -0.150], [0.052, -0.040], [0.049, 0.010],
    ], 16), skin);
    fore.castShadow = true;
    elbow.add(fore);

    const cuff = add(new THREE.TorusGeometry(0.047, 0.013, 6, 16), shirtDark, elbow, 0, -0.035, 0);
    cuff.rotation.x = Math.PI / 2;

    const hand = new THREE.Group();
    hand.position.y = -0.258;
    elbow.add(hand);
    add(new THREE.BoxGeometry(0.070, 0.082, 0.031), skin, hand, 0, -0.036, 0);
    for (let f = 0; f < 4; f++) {
      const fing = add(new THREE.CapsuleGeometry(0.0105, 0.040, 3, 6), skin, hand,
        (f - 1.5) * 0.0165, -0.092, 0.001);
      fing.rotation.x = 0.12 + f * 0.02;
    }
    const thumb = add(new THREE.CapsuleGeometry(0.0125, 0.034, 3, 6), skin, hand, s * 0.040, -0.046, 0.010);
    thumb.rotation.z = s * 0.62;

    arms[s < 0 ? 'l' : 'r'] = { shoulder, elbow, hand };
  }

  /* ------------------------------------------------------- legs */
  const legs = {};
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.086, -0.020, 0);
    hips.add(hip);
    add(new THREE.SphereGeometry(0.070, 14, 10), pants, hip, 0, 0, 0).scale.set(1, 0.95, 0.95);

    const thigh = new THREE.Mesh(lathe([
      [0.052, -0.430], [0.064, -0.300], [0.080, -0.130], [0.088, 0.000],
    ], 18), pants);
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.430;
    hip.add(knee);
    add(new THREE.SphereGeometry(0.054, 12, 10), pants, knee, 0, 0, 0).scale.set(1, 1, 0.95);

    const shin = new THREE.Mesh(lathe([
      [0.040, -0.400], [0.048, -0.250], [0.060, -0.070], [0.056, 0.000],
    ], 18), pants);
    shin.castShadow = true;
    knee.add(shin);

    const bootG = new THREE.Group();
    bootG.position.y = -0.400;
    knee.add(bootG);
    add(new THREE.CylinderGeometry(0.058, 0.068, 0.235, 16), bootMat, bootG, 0, -0.045, 0);
    const foot = add(new THREE.BoxGeometry(0.096, 0.070, 0.225), bootMat, bootG, 0, -0.155, -0.042);
    foot.rotation.x = -0.02;
    add(new THREE.SphereGeometry(0.046, 12, 10), bootMat, bootG, 0, -0.150, -0.150).scale.set(1.0, 0.82, 0.95);
    add(new THREE.BoxGeometry(0.100, 0.026, 0.232), soleMat, bootG, 0, -0.193, -0.042);

    legs[s < 0 ? 'l' : 'r'] = { hip, knee, boot: bootG };
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, hips, torso, head, arms, legs };
}

export class Player {
  constructor(scene) {
    this.body = buildCharacter();
    this.root = this.body.root;
    this.modelMixer = null;
    this.modelActions = null;
    this.modelAction = null;
    new GLTFLoader().load('assets/characters/Henry.gltf', (gltf) => {
      const model = gltf.scene;
      model.rotation.y = Math.PI;
      model.traverse((part) => {
        if (part.isMesh) {
          part.castShadow = true;
          part.receiveShadow = true;
        }
      });
      this.root.children.forEach((part) => { part.visible = false; });
      this.root.add(model);
      this.modelMixer = new THREE.AnimationMixer(model);
      this.modelActions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, this.modelMixer.clipAction(clip)]));
      this.playModelAction('Idle');
      this.modelLoaded = true;
    }, undefined, (error) => {
      console.warn('Pirate character could not load; using the original explorer.', error);
    });
    this.pos = new THREE.Vector3(0, 0, 13);
    this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.orbitYaw = 0;
    this.inspectMode = false;
    this.savedView = null;
    this.pitch = 0.22;
    this.onGround = true;
    this.speed = 0;
    this.walkPhase = 0;
    this.radius = 0.34;
    this.eyeHeight = 1.52;
    this.camDist = 4.5;
    this.camHeight = 1.55;
    this.leanT = 0;

    this.camPos = new THREE.Vector3();
    this.camTarget = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);

    scene.add(this.root);
  }

  addLook(dx, dy, sens = 1) {
    if (this.inspectMode) this.orbitYaw -= dx * 0.0022 * sens;
    else this.yaw -= dx * 0.0022 * sens;
    this.pitch = clamp(this.pitch + dy * 0.0018 * sens, this.inspectMode ? -0.95 : -0.42, this.inspectMode ? 1.25 : 1.05);
  }

  toggleInspectMode() {
    this.inspectMode = !this.inspectMode;
    if (this.inspectMode) {
      this.savedView = { pitch: this.pitch, camDist: this.camDist };
      this.orbitYaw = this.yaw;
      this.pitch = 0.08;
      this.camDist = 3.8;
    } else if (this.savedView) {
      this.pitch = this.savedView.pitch;
      this.camDist = this.savedView.camDist;
      this.savedView = null;
    }
    return this.inspectMode;
  }

  setInspectAngle(angle) {
    if (!this.inspectMode) return;
    this.orbitYaw = this.yaw + angle;
    this.pitch = 0.08;
  }

  playModelAction(name) {
    const next = this.modelActions && this.modelActions[name];
    if (!next || this.modelAction === next) return;
    if (this.modelAction) this.modelAction.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    this.modelAction = next;
  }

  /** ray vs axis-aligned box: returns the entry distance, or -1 */
  static rayBox(ox, oy, oz, dx, dy, dz, c, pad, maxT) {
    const lo = [c.minX - pad, (c.baseY ?? -2) - pad, c.minZ - pad];
    const hi = [c.maxX + pad, (c.baseY ?? -2) + (c.h ?? 2.4) + pad, c.maxZ + pad];
    const o = [ox, oy, oz], d = [dx, dy, dz];
    let t0 = 0, t1 = maxT;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-7) {
        if (o[i] < lo[i] || o[i] > hi[i]) return -1;
        continue;
      }
      let ta = (lo[i] - o[i]) / d[i];
      let tb = (hi[i] - o[i]) / d[i];
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    return t0;
  }

  resolveCollision(colliders) {
    const r = this.radius;
    for (const c of colliders) {
      // low enough to walk up onto: don't block, the ground query lifts us
      if (c.top !== undefined && c.top <= this.pos.y + 0.46) continue;
      if (this.pos.x > c.minX - r && this.pos.x < c.maxX + r &&
          this.pos.z > c.minZ - r && this.pos.z < c.maxZ + r) {
        const dl = this.pos.x - (c.minX - r);
        const dr = (c.maxX + r) - this.pos.x;
        const db = this.pos.z - (c.minZ - r);
        const df = (c.maxZ + r) - this.pos.z;
        const m = Math.min(dl, dr, db, df);
        if (m === dl) this.pos.x = c.minX - r;
        else if (m === dr) this.pos.x = c.maxX + r;
        else if (m === db) this.pos.z = c.minZ - r;
        else this.pos.z = c.maxZ + r;
      }
    }
  }

  update(dt, input, colliders, camera) {
    // ---- look
    if (input.lookX || input.lookY) this.addLook(input.lookX, input.lookY, input.touch ? 1.6 : 1);
    input.lookX = 0; input.lookY = 0;

    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.copy(this.forward).cross(UP).normalize();

    // ---- desired movement
    const wish = new THREE.Vector3();
    wish.addScaledVector(this.forward, input.moveY);
    wish.addScaledVector(this.right, input.moveX);
    if (wish.lengthSq() > 1) wish.normalize();

    const sprinting = input.sprint && wish.lengthSq() > 0.1;
    const targetSpeed = sprinting ? 6.6 : 3.5;
    const target = wish.multiplyScalar(targetSpeed);

    const accel = this.onGround ? 16 : 5;
    this.vel.x = lerp(this.vel.x, target.x, clamp(accel * dt, 0, 1));
    this.vel.z = lerp(this.vel.z, target.z, clamp(accel * dt, 0, 1));

    // ---- gravity + jump
    this.vel.y -= 24 * dt;
    if (input.jump && this.onGround) {
      this.vel.y = 7.6;
      this.onGround = false;
    }

    // ---- integrate with axis-separated collision
    this.pos.x += this.vel.x * dt;
    this.resolveCollision(colliders);
    this.pos.z += this.vel.z * dt;
    this.resolveCollision(colliders);
    this.pos.y += this.vel.y * dt;

    const ground = this.groundAt(colliders);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.05) {
      this.onGround = false;
    }

    // keep on the island
    const rad = Math.hypot(this.pos.x, this.pos.z);
    if (rad > 88) {
      this.pos.x *= 88 / rad;
      this.pos.z *= 88 / rad;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ---- pose
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    const amp = clamp(this.speed / 3.6, 0, 1.35);
    this.walkPhase += dt * (2.6 + this.speed * 1.35);
    const ph = this.walkPhase;
    const b = this.body;

    if (this.onGround) {
      b.legs.l.hip.rotation.x = Math.sin(ph) * 0.72 * amp;
      b.legs.r.hip.rotation.x = -Math.sin(ph) * 0.72 * amp;
      b.legs.l.knee.rotation.x = Math.max(0, -Math.sin(ph - 0.5)) * 0.85 * amp;
      b.legs.r.knee.rotation.x = Math.max(0, Math.sin(ph - 0.5)) * 0.85 * amp;
      b.arms.l.shoulder.rotation.x = -Math.sin(ph) * 0.62 * amp;
      b.arms.r.shoulder.rotation.x = Math.sin(ph) * 0.62 * amp;
      b.arms.l.elbow.rotation.x = -0.25 - Math.max(0, Math.sin(ph)) * 0.4 * amp;
      b.arms.r.elbow.rotation.x = -0.25 - Math.max(0, -Math.sin(ph)) * 0.4 * amp;
      b.arms.l.shoulder.rotation.z = 0.12 + Math.sin(ph) * 0.03;
      b.arms.r.shoulder.rotation.z = -0.12 - Math.sin(ph) * 0.03;
      if (!this.modelLoaded) this.root.position.y += Math.abs(Math.sin(ph)) * 0.035 * amp;
    } else {
      b.legs.l.hip.rotation.x = lerp(b.legs.l.hip.rotation.x, 0.35, dt * 8);
      b.legs.r.hip.rotation.x = lerp(b.legs.r.hip.rotation.x, -0.25, dt * 8);
      b.legs.l.knee.rotation.x = lerp(b.legs.l.knee.rotation.x, 0.7, dt * 8);
      b.legs.r.knee.rotation.x = lerp(b.legs.r.knee.rotation.x, 0.25, dt * 8);
      b.arms.l.shoulder.rotation.x = lerp(b.arms.l.shoulder.rotation.x, -0.9, dt * 6);
      b.arms.r.shoulder.rotation.x = lerp(b.arms.r.shoulder.rotation.x, -0.9, dt * 6);
      b.arms.l.shoulder.rotation.z = 0.3;
      b.arms.r.shoulder.rotation.z = -0.3;
    }

    // idle breathing + speed lean
    const idle = 1 - amp;
    b.hips.position.y = 0.95 + Math.sin(ph * 0.55) * 0.006 * idle;
    this.leanT = lerp(this.leanT, amp * (sprinting ? 1 : 0.55), dt * 4);
    b.torso.rotation.x = this.leanT * 0.13;
    b.torso.rotation.y = Math.sin(ph) * 0.05 * amp;
    b.head.rotation.x = -this.pitch * 0.35;

    if (this.modelMixer) {
      this.playModelAction(!this.onGround ? 'Jump_Idle' : this.speed < 0.35 ? 'Idle' : sprinting ? 'Run' : 'Walk');
      this.modelMixer.update(dt);
    }

    // ---- camera
    const targetY = this.pos.y + this.camHeight;
    this.camTarget.lerp(new THREE.Vector3(this.pos.x, targetY, this.pos.z), clamp(dt * 12, 0, 1));
    if (this.camTarget.lengthSq() === 0) this.camTarget.set(this.pos.x, targetY, this.pos.z);

    const dist = this.camDist;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cameraYaw = this.inspectMode ? this.orbitYaw : this.yaw;
    const desired = new THREE.Vector3(
      this.camTarget.x + Math.sin(cameraYaw) * cp * dist,
      this.camTarget.y + sp * dist,
      this.camTarget.z + Math.cos(cameraYaw) * cp * dist,
    );

    // pull the camera in until nothing is between it and the character,
    // so walls never get clipped through
    const origin = this.camTarget;
    const dir = desired.clone().sub(origin);
    const maxLen = dir.length();
    if (maxLen > 1e-4 && !this.inspectMode) {
      dir.multiplyScalar(1 / maxLen);
      let hitT = maxLen;
      for (const c of colliders) {
        if (c.top !== undefined && c.top < origin.y - 0.3) continue; // under our feet
        const t = Player.rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c, 0.34, maxLen);
        if (t >= 0 && t < hitT) hitT = t;
      }
      // and stay above the terrain
      for (let sdist = 0.45; sdist < Math.min(hitT, maxLen); sdist += 0.3) {
        const px = origin.x + dir.x * sdist;
        const py = origin.y + dir.y * sdist;
        const pz = origin.z + dir.z * sdist;
        if (py < terrainHeight(px, pz) + 0.45) { hitT = Math.max(0.6, sdist - 0.15); break; }
      }
      desired.copy(origin).addScaledVector(dir, Math.max(0.85, hitT - 0.1));
    }

    // snap in fast when something occludes, ease out slowly
    const closer = desired.distanceToSquared(origin) < this.camPos.distanceToSquared(origin) - 1e-4;
    this.camPos.lerp(desired, clamp(dt * (closer ? 30 : 9), 0, 1));
    if (this.camPos.lengthSq() === 0) this.camPos.copy(desired);

    // hide the body when the camera is pulled right up against it
    this.root.visible = this.camPos.distanceTo(this.camTarget) > 1.35;

    camera.position.copy(this.camPos);
    const look = this.inspectMode ? this.camTarget.clone() : this.camTarget.clone().addScaledVector(this.forward, 1.2);
    look.y += this.inspectMode ? -0.15 : 0.15 - this.pitch * 0.9;
    camera.lookAt(look);
  }

  /** terrain, or the top of a low box the player is standing on */
  groundAt(colliders) {
    const r = this.radius;
    let g = terrainHeight(this.pos.x, this.pos.z);
    for (const c of colliders) {
      if (c.top === undefined) continue;
      if (this.pos.x > c.minX - r && this.pos.x < c.maxX + r &&
          this.pos.z > c.minZ - r && this.pos.z < c.maxZ + r &&
          c.top <= this.pos.y + 0.5 && c.top > g) g = c.top;
    }
    return g;
  }

  getInteractionPoint() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z);
  }

  getForwardFlat() {
    return this.forward;
  }
}
