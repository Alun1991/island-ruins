import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, smoothstep, fbm2, dustSprite, groundSurface } from './util.js';

export const SEA_LEVEL = 0;
const ISLAND_R = 95;

export function terrainHeight(x, z) {
  const d = Math.hypot(x, z * 0.9) / ISLAND_R;
  let h = 2.7 * smoothstep(0.94, 0.48, d);
  h += 1.5 * Math.exp(-((x * x) + (z + 12) * (z + 12)) / 1100);

  const ridge = fbm2(x * 0.030 + 3.2, z * 0.030 - 1.7, 4) - 0.5;
  const detail = fbm2(x * 0.17, z * 0.17, 3) - 0.5;
  const flat = smoothstep(0.95, 0.32, Math.max(Math.abs(x) / 31, Math.abs(z + 11) / 25));
  h += ridge * 3.4 * (1 - 0.78 * flat);
  h += detail * 0.5 * (1 - 0.85 * flat);
  h -= smoothstep(0.86, 1.16, d) * 5.2;
  return h;
}

export function pathCenterX(z) {
  return Math.sin((z + 12) * 0.085) * 3.6 + Math.sin((z + 3) * 0.21) * 0.9;
}

/* --------------------------------------------------------------- sky */
function createSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: sunDir.clone() },
      uZenith: { value: new THREE.Color(0x2f6ea8) },
      uHorizon: { value: new THREE.Color(0xcfdce2) },
      uHazeColor: { value: new THREE.Color(0xffdca8) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSun, uZenith, uHorizon, uHazeColor;
      uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float s = 0.0, a = 0.5;
        for(int i = 0; i < 5; i++){ s += noise(p) * a; p *= 2.03; a *= 0.5; }
        return s;
      }
      void main(){
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, -1.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
        col = mix(col, uHorizon * 1.05, smoothstep(0.16, -0.05, h));

        float sunDot = max(dot(dir, uSun), 0.0);
        col += uHazeColor * pow(sunDot, 8.0) * 0.55;
        col += uHazeColor * pow(sunDot, 90.0) * 1.6;
        col += vec3(1.0, 0.95, 0.82) * smoothstep(0.9993, 0.9999, sunDot) * 9.0;

        // soft tropical cloud band
        vec2 uv = dir.xz / max(0.12, dir.y + 0.24) * 0.7;
        float c = fbm(uv * 1.15 + vec2(uTime * 0.004, uTime * 0.002));
        c = smoothstep(0.52, 0.92, c) * smoothstep(0.02, 0.32, h);
        col = mix(col, vec3(0.93, 0.95, 0.92) * (1.0 + sunDot * 1.4), c * 0.72);

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/* --------------------------------------------------------------- ocean */
function createOcean(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir.clone() },
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0.035, 0.105, 0.115) },
      uShallow: { value: new THREE.Color(0.10, 0.28, 0.29) },
      uSky: { value: new THREE.Color(0.62, 0.74, 0.80) },
      uFogColor: { value: new THREE.Color(0x93a58c) },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vWorld;
      uniform vec3 uSun, uDeep, uShallow, uSky, uFogColor;
      uniform float uTime;

      float wave(vec2 p, vec2 d, float f, float s){
        return sin(dot(p, d) * f + uTime * s);
      }
      void main(){
        vec2 p = vWorld.xz;
        float t = uTime;
        vec3 n = vec3(0.0, 1.0, 0.0);
        n.x += wave(p, normalize(vec2(1.0, 0.25)), 0.55, 0.55) * 0.055;
        n.z += wave(p, normalize(vec2(-0.3, 1.0)), 0.75, 0.68) * 0.045;
        n.x += wave(p, normalize(vec2(0.6, -0.8)), 1.9, 1.15) * 0.020;
        n.z += wave(p, normalize(vec2(0.9, 0.4)), 2.7, 1.4) * 0.016;
        n = normalize(n);

        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);

        float dist = length(p);
        vec3 base = mix(uShallow, uDeep, smoothstep(70.0, 150.0, dist));

        vec3 col = mix(base, uSky, fres * 0.85);

        vec3 h = normalize(uSun + viewDir);
        float spec = pow(max(dot(n, h), 0.0), 340.0);
        col += vec3(1.0, 0.92, 0.72) * spec * 7.0;

        // shoreline foam ring
        float shore = smoothstep(96.0, 82.0, dist);
        float foamNoise = fract(sin(dot(floor(p * 0.6), vec2(12.9898, 78.233))) * 43758.5453);
        col = mix(col, vec3(0.86, 0.90, 0.86), shore * 0.32 * (0.55 + foamNoise * 0.45));

        float fogF = 1.0 - exp(-pow(dist * 0.0062, 2.0));
        col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = SEA_LEVEL;
  return mesh;
}

/* ------------------------------------------------------------- ground */
function groundMaterial() {
  const surf = groundSurface(150);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: surf.map,
    normalMap: surf.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.95,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    // low-frequency variation is computed per vertex; the fragment shader only
    // does one cheap high-frequency detail lookup
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec2 vMott;
float vHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vHash(i), vHash(i + vec2(1,0)), u.x),
             mix(vHash(i + vec2(0,1)), vHash(i + vec2(1,1)), u.x), u.y);
}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec2 xz = vWPos.xz;
  float n1 = vNoise(xz * 1.6);
  float n2 = vNoise(xz * 7.5);
  float fbm = vNoise(xz * 0.055) * 0.5 + vNoise(xz * 0.1116) * 0.25 + vNoise(xz * 0.2265) * 0.125;
  vMott = vec2(n1 * 0.55 + n2 * 0.3, fbm);
}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec2 vMott;
float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1,0)), u.x),
             mix(gHash(i + vec2(0,1)), gHash(i + vec2(1,1)), u.x), u.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float n3 = gNoise(vWPos.xz * 33.0);
  float mott = vMott.x + n3 * 0.15;
  diffuseColor.rgb *= 0.86 + mott * 0.30;
  float up = clamp(vNormal.y, 0.0, 1.0);
  vec3 moss = vec3(0.085, 0.155, 0.06);
  diffuseColor.rgb = mix(diffuseColor.rgb, moss, smoothstep(0.35, 0.95, up) * 0.14);

  // turf: same patch mask the grass instances use, so soil under grass is green
  float turf = smoothstep(0.36, 0.58, vMott.y) * smoothstep(0.45, 0.95, up);
  vec3 turfCol = mix(vec3(0.115, 0.170, 0.062), vec3(0.165, 0.215, 0.085), n3);
  diffuseColor.rgb = mix(diffuseColor.rgb, turfCol, turf * 0.80);
}`);
  };
  return mat;
}

function createTerrain() {
  const size = 300, seg = 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  geo.computeVertexNormals();

  const colors = new Float32Array(pos.count * 3);
  const nor = geo.attributes.normal;
  const sand = new THREE.Color(0.60, 0.53, 0.38);
  const grassA = new THREE.Color(0.17, 0.30, 0.11);
  const grassB = new THREE.Color(0.28, 0.40, 0.16);
  const rock = new THREE.Color(0.33, 0.31, 0.27);
  const dirt = new THREE.Color(0.46, 0.35, 0.23);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - clamp(nor.getY(i), 0, 1);
    const nz = fbm2(x * 0.09, z * 0.09, 3);
    c.copy(grassA).lerp(grassB, nz);

    c.lerp(rock, smoothstep(0.30, 0.62, slope));

    const beach = smoothstep(1.4, 0.35, y);
    c.lerp(sand, beach * 0.92);

    // bare soil shows through wherever the grass patches thin out
    const patchN = fbm2(x * 0.055, z * 0.055, 3);
    const gm = smoothstep(0.44, 0.60, patchN);            // same mask as the grass cards
    c.lerp(dirt, (1 - gm) * 0.92);

    const px = Math.abs(x - pathCenterX(z));
    const onPath = smoothstep(3.2, 0.9, px) * smoothstep(-24, -16, z) * smoothstep(20, 14, z);
    c.lerp(dirt, onPath * 0.8);

    const shade = 0.85 + fbm2(x * 0.6, z * 0.6, 2) * 0.3;
    c.multiplyScalar(shade * 2.15);

    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geo, groundMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/* --------------------------------------------------------------- setup */
export function createEnvironment(scene, renderer) {
  const sunDir = new THREE.Vector3(0.42, 0.80, 0.44).normalize();

  scene.fog = new THREE.FogExp2(0xa9bcbb, 0.0072);

  const sky = createSky(sunDir);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xffd2a0, 3.1);
  sun.position.copy(sunDir).multiplyScalar(80);
  sun.castShadow = true;
  const lowQ = new URLSearchParams(location.search).get('q') === 'low';
  sun.shadow.mapSize.set(lowQ ? 1024 : 2048, lowQ ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 3.0;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x9dc4d8, 0x232b18, 0.42);
  scene.add(hemi);

  const bounce = new THREE.DirectionalLight(0xbcd6a8, 0.22);
  bounce.position.set(0.5, 0.25, 0.8).multiplyScalar(50);
  scene.add(bounce);

  const ocean = createOcean(sunDir);
  scene.add(ocean);

  const terrain = createTerrain();
  scene.add(terrain);

  // floating pollen / dust
  const dustCount = 620;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(dustCount * 3);
  const dseed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dpos[i * 3] = (Math.random() - 0.5) * 80;
    dpos[i * 3 + 1] = Math.random() * 16;
    dpos[i * 3 + 2] = (Math.random() - 0.5) * 80 - 8;
    dseed[i] = Math.random();
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dustMat = new THREE.PointsMaterial({
    size: 0.075,
    map: dustSprite(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  const sunWorld = sunDir.clone().multiplyScalar(300);

  return {
    sun, sunDir, sunWorld, sky, ocean, terrain, dust, dseed,
    update(t, camera) {
      sky.material.uniforms.uTime.value = t;
      ocean.material.uniforms.uTime.value = t;
      const arr = dust.geometry.attributes.position;
      for (let i = 0; i < arr.count; i++) {
        let y = arr.getY(i) + (0.16 + dseed[i] * 0.24) * 0.016;
        let x = arr.getX(i) + Math.sin(t * 0.4 + dseed[i] * 12) * 0.0025;
        let z = arr.getZ(i) + Math.cos(t * 0.33 + dseed[i] * 9) * 0.0025;
        if (y > 17) y = 0.2;
        if (x > 40) x = -40; if (x < -40) x = 40;
        if (z > 32) z = -48; if (z < -48) z = 32;
        arr.setXYZ(i, x, y, z);
      }
      arr.needsUpdate = true;
    },
  };
}
