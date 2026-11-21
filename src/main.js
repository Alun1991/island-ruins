import * as THREE from '../vendor/three.module.js';
import { PostFX } from './post.js';
import { createEnvironment, terrainHeight } from './env.js';
import { createRuins } from './ruins.js';
import { createFlora } from './flora.js';
import { Player } from './player.js';
import { HUD } from './hud.js';
import { Ambience } from './audio.js';
import { timeUniform, clamp } from './util.js';

/* debug channel: surfaces runtime errors in the DOM so headless runs can report them */
const errBox = document.createElement('div');
errBox.id = 'errbox';
errBox.style.cssText = 'position:fixed;left:0;bottom:0;z-index:999;display:none;white-space:pre;font:11px monospace;color:#f88;background:#000a;padding:4px;';
document.body.appendChild(errBox);
window.addEventListener('error', (e) => {
  errBox.style.display = 'block';
  errBox.textContent += `[error] ${e.message} @ ${e.filename}:${e.lineno}\n`;
});
window.addEventListener('unhandledrejection', (e) => {
  errBox.style.display = 'block';
  errBox.textContent += `[reject] ${e.reason && e.reason.stack || e.reason}\n`;
});
window.__errors = [];

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 1400);

const dbg = new URLSearchParams(location.search).get('debug');
const lowQ = new URLSearchParams(location.search).get('q') === 'low';
const post = new PostFX(renderer, dbg === 'ao' ? 1 : dbg === 'depth' ? 2 : dbg === 'raw' ? 3 : 0);

const env = createEnvironment(scene, renderer);
env.sun.target.position.set(0, 2, -10);
env.sun.position.copy(env.sun.target.position).addScaledVector(env.sunDir, 80);

const ruins = createRuins(scene);
const flora = createFlora(scene, ruins.colliders);
const player = new Player(scene);
const hud = new HUD();
const ambience = new Ambience();


/* --------------------------------------------- objective beams + waypoint */
const beaconMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uColor: { value: new THREE.Color(0xffb768) }, uFade: { value: 1 } },
  vertexShader: /* glsl */`
    varying float vH;
    void main(){ vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform float uFade;
    varying float vH;
    void main(){
      float a = pow(1.0 - vH, 2.2) * 0.34 * uFade;
      gl_FragColor = vec4(uColor, a);
    }`,
});
const beamGeo = new THREE.CylinderGeometry(0.13, 0.26, 6.5, 10, 1, true);
const gemGeo = new THREE.OctahedronGeometry(0.2);
const gemMat = new THREE.MeshBasicMaterial({ color: 0xffd99a, transparent: true, opacity: 0.92, toneMapped: false });

// soft radial glow sprite — drawn on top of everything so a target is never lost
function glowTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0.0, 'rgba(255,232,178,1)');
  grd.addColorStop(0.28, 'rgba(255,198,110,0.62)');
  grd.addColorStop(0.62, 'rgba(255,168,64,0.18)');
  grd.addColorStop(1.0, 'rgba(255,150,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = glowTexture();
const ringGeo = new THREE.RingGeometry(0.46, 0.62, 32);

const beacons = [];
for (const it of ruins.interactables) {
  const groundY = terrainHeight(it.pos.x, it.pos.z);
  const h = Math.max(0.5, it.pos.y - groundY);   // how high the object sits
  const standOnGround = it.type !== 'note';      // note hangs on a wall

  const g = new THREE.Group();
  g.position.set(it.pos.x, groundY, it.pos.z);

  // beam rising from the ground, not from the object
  const beamMat = beaconMat.clone();
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 3.25;
  beam.renderOrder = 3;

  const gem = new THREE.Mesh(gemGeo, gemMat);
  gem.position.y = h + 0.5;
  gem.renderOrder = 5;

  // halo around the object itself, never hidden by walls
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.85,
  }));
  halo.position.y = h + 0.05;
  halo.scale.set(1.6, 1.6, 1);
  halo.renderOrder = 4;

  // where to stand
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xffc074, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  ring.renderOrder = 2;

  g.add(beam, gem, halo);
  if (standOnGround) g.add(ring);
  scene.add(g);
  beacons.push({ it, g, gem, halo, ring, h, beamMat, haloMat: halo.material });
}

/* --------------------------------------------- on-screen guidance marker */
const wm = document.getElementById('wm');
const wmArrow = document.getElementById('wm-arrow');
const wmRing = document.getElementById('wm-ring');
const wmLbl = document.getElementById('wm-lbl');
const _wmv = new THREE.Vector3();

function updateWaypoint(dt, t) {
  let best = null, bestD = Infinity;
  for (const it of ruins.interactables) {
    if (it.taken) continue;
    const d = it.pos.distanceTo(player.pos);
    if (d < bestD) { bestD = d; best = it; }
  }
  for (const b of beacons) {
    const vis = !b.it.taken;
    b.g.visible = vis;
    if (vis) {
      const d = b.it.pos.distanceTo(player.pos);
      const fade = clamp((d - 1.8) / 4.2, 0, 1);   // fades out as you walk up to it
      b.gem.visible = d > 2.2;
      b.gem.rotation.y += dt * 1.1;
      b.gem.position.y = b.h + 0.5 + Math.sin(t * 1.8 + b.it.pos.x) * 0.13;
      b.beamMat.uniforms.uFade.value = fade;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + b.it.pos.x);
      const k = 1.15 + pulse * 0.5;
      b.halo.scale.set(k, k, 1);
      b.halo.material.opacity = (0.55 + pulse * 0.4) * (0.25 + fade * 0.75);
      if (b.ring) {
        const rs = 1 + pulse * 0.12;
        b.ring.scale.set(rs, rs, 1);
        b.ring.material.opacity = (0.35 + pulse * 0.3) * fade;
      }
    }
  }
  if (!best || hud.modalOpen || bestD < 1.6) { wm.classList.remove('on'); return; }

  _wmv.copy(best.pos).project(camera);
  const W = window.innerWidth, H = window.innerHeight;
  const behind = _wmv.z > 1;
  let nx = _wmv.x, ny = _wmv.y;
  if (behind) { nx = -nx; ny = -ny; }

  const onScreen = !behind && Math.abs(nx) < 0.84 && Math.abs(ny) < 0.80;
  let px, py, angle = 0;
  if (onScreen) {
    px = (nx * 0.5 + 0.5) * W;
    py = (-ny * 0.5 + 0.5) * H;
  } else {
    const ux = nx * (W / H), uy = ny;
    const k = 0.86 / (Math.max(Math.abs(ux), Math.abs(uy)) || 1e-6);
    px = (ux * k * 0.5 + 0.5) * W;
    py = (-uy * k * 0.5 + 0.5) * H;
    angle = Math.atan2(-uy, ux) * 180 / Math.PI;
  }

  wm.classList.add('on');
  wm.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
  wmArrow.style.display = onScreen ? 'none' : 'flex';
  wmArrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
  wmRing.style.display = onScreen ? 'block' : 'none';
  wmLbl.innerHTML = `${best.label} <b>${Math.round(bestD)}m</b>`;
  wmLbl.style.top = onScreen ? '16px' : '-30px';
}

window.__g = { player, camera, scene, env, ruins, post, hud, beacons };

/* --------------------------------------------------------------- input */
const input = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, jump: false, sprint: false, touch: false };
const keys = new Set();
let started = false;
let locked = false;
let dragging = false;
function requestGamePointerLock() {
  if (!canvas.requestPointerLock) return;
  try {
    const request = canvas.requestPointerLock();
    if (request && request.catch) request.catch(() => {});
  } catch (_) {
    // Dragging still works when the browser does not allow pointer lock.
  }
}

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) { document.body.classList.add('is-touch'); input.touch = true; }

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyE' && started) tryInteract();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyV' && started && !e.repeat) toggleInspect();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let lastMX = 0, lastMY = 0;
canvas.addEventListener('mousedown', (e) => {
  if (!started) return;
  lastMX = e.clientX; lastMY = e.clientY;
  dragging = true;
  if (!locked && !isTouch) {
    requestGamePointerLock();
  }
});
window.addEventListener('mouseup', () => { dragging = false; });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', locked);
});
window.addEventListener('mousemove', (e) => {
  if (hud.modalOpen) return;
  if (locked) {
    input.lookX += e.movementX;
    input.lookY += e.movementY;
  } else if (dragging) {
    // works even without pointer lock: drag the picture to turn
    // drag needs more travel than a locked mouse: ~160px of drag ≈ 90°
    input.lookX += (e.clientX - lastMX) * 4.4;
    input.lookY += (e.clientY - lastMY) * 3.2;
    lastMX = e.clientX; lastMY = e.clientY;
  }
});
window.addEventListener('wheel', (e) => {
  if (!started) return;
  player.camDist = clamp(player.camDist + Math.sign(e.deltaY) * 0.35, 2.4, 7.2);
}, { passive: true });

/* ------------------------------------------------------------ touch UI */
const stick = document.getElementById('stick');
const knob = document.getElementById('stick-knob');
let stickId = null, stickCenter = { x: 0, y: 0 };

if (isTouch && stick) {
  const setStick = (t) => {
    const dx = t.clientX - stickCenter.x;
    const dy = t.clientY - stickCenter.y;
    const mag = Math.min(48, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(a) * mag}px, ${Math.sin(a) * mag}px)`;
    input.moveX = (Math.cos(a) * mag) / 48;
    input.moveY = -(Math.sin(a) * mag) / 48;
    input.sprint = mag > 40;
  };
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const r = stick.getBoundingClientRect();
    stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setStick(t);
    e.preventDefault();
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === stickId) setStick(t);
    e.preventDefault();
  }, { passive: false });
  const endStick = () => {
    stickId = null; input.moveX = 0; input.moveY = 0; input.sprint = false;
    knob.style.transform = 'translate(0px, 0px)';
  };
  stick.addEventListener('touchend', endStick);
  stick.addEventListener('touchcancel', endStick);

  let lookId = null, lastLook = { x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    lookId = t.identifier;
    lastLook = { x: t.clientX, y: t.clientY };
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      input.lookX += (t.clientX - lastLook.x) * 1.35;
      input.lookY += (t.clientY - lastLook.y) * 1.35;
      lastLook = { x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  }, { passive: false });
  const endLook = () => { lookId = null; };
  canvas.addEventListener('touchend', endLook);
  canvas.addEventListener('touchcancel', endLook);

  document.getElementById('btn-jump').addEventListener('touchstart', (e) => {
    input.jump = true;
    e.preventDefault();
  }, { passive: false });
  document.getElementById('btn-jump').addEventListener('touchend', () => { input.jump = false; });
  document.getElementById('btn-use').addEventListener('touchstart', (e) => {
    if (started) tryInteract();
    e.preventDefault();
  }, { passive: false });
}

const muteBtn = document.getElementById('mute');
function toggleMute() {
  ambience.mute(!ambience.muted);
  muteBtn.classList.toggle('off', ambience.muted);
  muteBtn.setAttribute('aria-pressed', String(ambience.muted));
}
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
muteBtn.classList.toggle('off', ambience.muted);

const inspectBtn = document.getElementById('inspect');
function toggleInspect() {
  const inspecting = player.toggleInspectMode();
  inspectBtn.classList.toggle('on', inspecting);
  inspectBtn.setAttribute('aria-pressed', String(inspecting));
  inspectBtn.textContent = inspecting ? '返回游戏' : '观察角色';
  document.body.classList.toggle('inspecting', inspecting);
  if (inspecting) document.querySelector('#angles [data-angle="0"]').click();
  hud.toast(inspecting ? '拖动画面环绕角色 · 滚轮调整远近 · V 返回' : '已返回探索视角', 3000);
}
inspectBtn.addEventListener('click', (e) => { e.stopPropagation(); if (started) toggleInspect(); });
document.querySelectorAll('#angles button').forEach((button) => {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!started || !player.inspectMode) return;
    player.setInspectAngle(Number(button.dataset.angle));
    document.querySelectorAll('#angles button').forEach((item) => item.classList.toggle('active', item === button));
  });
});

/* ----------------------------------------------------------- objectives */
const TOTAL = 3;
const collected = new Set();
const objectiveItems = () => [
  { text: '登上小岛，接近被丛林吞没的废墟', done: true },
  { text: '打开遗留的木箱', done: collected.has('chest') },
  { text: '阅读墙上的便条', done: collected.has('note') },
  { text: '辨认拱廊里的刻文石板', done: collected.has('tablet') },
];
function refreshObjectives() {
  hud.setObjectives(objectiveItems());
  hud.setProgress(collected.size, TOTAL);
}
refreshObjectives();

function showEnding() {
  if (document.exitPointerLock) document.exitPointerLock();
  document.getElementById('ending').classList.add('on');
  hud.hidePrompt();
  ambience.chime();
}

function collect(id) {
  if (collected.has(id)) return;
  collected.add(id);
  refreshObjectives();
  if (collected.size >= TOTAL) {
    if (hud.modalOpen) hud.onModalClose = showEnding;
    else setTimeout(showEnding, 700);
  }
}

document.getElementById('ending-continue').addEventListener('click', () => {
  document.getElementById('ending').classList.remove('on');
  hud.toast('你仍可以留在岛上探索。', 3000);
});
document.getElementById('ending-restart').addEventListener('click', () => location.reload());

/* ---------------------------------------------------------- interactions */
let nearTarget = null;
let lidT = -1;

function nearestInteractable() {
  const p = player.getInteractionPoint();
  let best = null, bestD = 1e9;
  for (const it of ruins.interactables) {
    if (it.taken) continue;
    const flat = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
    const d = p.distanceTo(it.pos);
    if (d > it.radius) continue;
    if (flat > 2.2) {
      const to = new THREE.Vector3(it.pos.x - p.x, 0, it.pos.z - p.z).normalize();
      if (to.dot(player.forward) < 0.1) continue;
    }
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

const NOTE_TEXT = `
  <p>「第七个季度。货舱里剩下的东西比人还多。」</p>
  <p>船长说这片礁湖能避风，也确实避风——避了整整两年。桅杆烂了，罗盘锈了，
  钟楼上的钟还在响，可没人再去敲它。</p>
  <p>如果你读到这行字：箱子底下埋着的不是钱，是全部人的名字。
  请把它带回有人的地方。</p>
  <p class="sign">—— 记于码头第三级台阶</p>
`;

const TABLET_TEXT = `
  <p>石面被苔藓啃掉了大半，只余下断续的刻痕：</p>
  <p class="glyph">「凡自此登岸者 · 皆以风为证」</p>
  <p>下缘还有一行更小的字，像是后人所补：
  「岛不欢迎客人，它只等愿意留下的人。」</p>
`;

function tryInteract() {
  if (!started || hud.modalOpen || document.getElementById('ending').classList.contains('on')) return;
  const it = nearTarget || nearestInteractable();
  if (!it) return;
  if (it.type === 'chest') {
    it.taken = true;
    lidT = 0;
    it.glow.intensity = 2.6;
    ambience.thud();
    setTimeout(() => ambience.chime(), 260);
    hud.toast('获得：海盗金币 ×1');
    collect('chest');
  } else if (it.type === 'note') {
    it.taken = true;
    if (document.exitPointerLock) document.exitPointerLock();
    hud.openModal('泛黄的便条', NOTE_TEXT);
    collect('note');
  } else if (it.type === 'tablet') {
    it.taken = true;
    if (document.exitPointerLock) document.exitPointerLock();
    hud.openModal('刻文石板', TABLET_TEXT);
    collect('tablet');
  }
}

/* --------------------------------------------------------------- start */
const startEl = document.getElementById('start');
const startBtn = document.getElementById('start-btn');
function begin() {
  if (started) return;
  started = true;
  document.body.classList.add('started');
  startEl.classList.add('gone');
  ambience.start();
  if (!isTouch) requestGamePointerLock();
  setTimeout(() => hud.toast('WASD 移动 · Shift 疾行 · 空格跳跃 · E 交互', 4200), 500);
}
startBtn.addEventListener('click', begin);
startEl.addEventListener('click', begin);

const params = new URLSearchParams(location.search);
if (params.has('auto')) {
  setTimeout(begin, 120);
}
if (params.has('debug')) errBox.style.display = 'block';

/* ---------------------------------------------------------------- loop */
let lastTime = performance.now();
let stepIdx = 0;
let fpsAcc = 0, fpsFrames = 0;
const fpsEl = document.getElementById('fps');
const dbSize = new THREE.Vector2();

// dynamic resolution: keeps the frame time under ~14ms on any GPU
let renderScale = 1.0;
const MIN_SCALE = 0.55;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 1.5) * renderScale;
  if (Math.abs(renderer.getPixelRatio() - pr) > 1e-4) renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(dbSize);
  post.setSize(Math.max(2, dbSize.x | 0), Math.max(2, dbSize.y | 0));
}
window.addEventListener('resize', resize);
resize();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0005, (now - lastTime) / 1000));
  lastTime = now;
  timeUniform.value += dt;

  // movement input
  const active = started && !hud.modalOpen && !player.inspectMode && !document.getElementById('ending').classList.contains('on');
  if (active) {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    if (turn) input.lookX += turn * dt * 780;
    if (!isTouch || Math.abs(input.moveX) + Math.abs(input.moveY) < 0.01) {
      input.moveX = r;
      input.moveY = f;
    }
    input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || input.sprint;
    input.jump = keys.has('Space') || input.jump;
  } else {
    input.moveX = 0; input.moveY = 0; input.jump = false;
  }

  player.update(dt, input, ruins.colliders, camera);
  updateWaypoint(dt, now * 0.001);
  input.jump = false;
  if (isTouch) input.sprint = input.sprint && Math.hypot(input.moveX, input.moveY) > 0.85;
  else input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

  // footsteps
  const idx = Math.floor(player.walkPhase / Math.PI);
  if (idx !== stepIdx) {
    stepIdx = idx;
    if (player.speed > 0.8 && player.onGround) ambience.step();
  }

  // interaction detection
  if (active) {
    nearTarget = nearestInteractable();
    if (nearTarget) {
      hud.prompt(`${isTouch ? '按下 [交互]' : '按 E'} · ${nearTarget.label}`);
      document.body.classList.add('can-use');
    } else {
      hud.hidePrompt();
      document.body.classList.remove('can-use');
    }
  } else {
    hud.hidePrompt();
  }

  // chest lid animation
  if (lidT >= 0) {
    lidT = Math.min(1, lidT + dt * 1.9);
    const e = 1 - Math.pow(1 - lidT, 3);
    const chest = ruins.interactables.find((i) => i.type === 'chest');
    if (chest) {
      chest.lid.rotation.x = -1.85 * e;
      chest.lid.position.y = 0.5 + e * 0.06;
      chest.glow.intensity = Math.max(0, 2.6 * (1 - lidT * 0.55));
    }
  }

  env.update(timeUniform.value, camera);
  ruins.update(timeUniform.value);
  ambience.update(dt);
  hud.update(dt);

  const sunPoint = camera.position.clone().addScaledVector(env.sunDir, 600);
  if (lowQ) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  } else {
    post.render(scene, camera, dt, sunPoint);
  }

  fpsAcc += dt; fpsFrames++;
  // adapt resolution every half second
  if (fpsAcc > 0.5) {
    const fps = fpsFrames / fpsAcc;
    const prev = renderScale;
    if (fps < 48) renderScale = Math.max(MIN_SCALE, renderScale - 0.1);
    else if (fps > 58 && renderScale < 1) renderScale = Math.min(1, renderScale + 0.06);
    if (renderScale !== prev) resize();
  }
  if (fpsAcc > 0.5) {
    if (fpsEl) fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps`;
    fpsAcc = 0; fpsFrames = 0;
  }
}

requestAnimationFrame(frame);
