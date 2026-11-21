import * as THREE from '../vendor/three.module.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT = /* glsl */`
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold + 0.85, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
  s += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.3162162;
  s += (texture2D(tDiffuse, vUv + uDir * 3.2307).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307).rgb) * 0.0702702;
  gl_FragColor = vec4(s, 1.0);
}
`;

const RAYS = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uSun;
uniform float uDensity;
uniform float uDecay;
varying vec2 vUv;
const int SAMPLES = 28;
void main(){
  vec2 uv = vUv;
  vec2 delta = (uv - uSun) * (uDensity / float(SAMPLES));
  vec2 c = uv;
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    c -= delta;
    acc += texture2D(tDiffuse, clamp(c, vec2(0.001), vec2(0.999))).rgb * illum;
    illum *= uDecay;
  }
  gl_FragColor = vec4(acc / float(SAMPLES), 1.0);
}
`;


const SSAO = /* glsl */`
precision highp float;
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uRes;
uniform float uRadius;
uniform float uBias;
uniform float uIntensity;
varying vec2 vUv;

vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * c;
  return v.xyz / v.w;
}

void main(){
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }

  vec3 P = viewPos(vUv);
  vec3 Px = viewPos(vUv + vec2(1.0 / uRes.x, 0.0));
  vec3 Py = viewPos(vUv + vec2(0.0, 1.0 / uRes.y));
  vec3 N = normalize(cross(Px - P, Py - P));
  if (N.z < 0.0) N = -N;

  vec3 T = normalize(abs(N.z) < 0.9 ? cross(N, vec3(0.0, 0.0, 1.0)) : cross(N, vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(N, T);

  float ang = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  mat3 rot = mat3(ca, sa, 0.0, -sa, ca, 0.0, 0.0, 0.0, 1.0);

  float occ = 0.0;
  const int NS = 9;
  for (int i = 0; i < NS; i++) {
    float fi = float(i);
    float r = mix(0.30, 1.0, fi / float(NS));
    float a = fi * 2.39996;
    vec3 dir = vec3(cos(a) * r, sin(a) * r, sqrt(max(0.0, 1.0 - r * r)));
    vec3 s = P + (rot * (T * dir.x + B * dir.y + N * dir.z)) * uRadius;
    vec4 clip = uProj * vec4(s, 1.0);
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    vec3 SP = viewPos(suv);
    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(0.0001, abs(P.z - SP.z)));
    occ += (SP.z > s.z + uBias ? 1.0 : 0.0) * rangeCheck;
  }

  float ao = 1.0 - (occ / float(NS)) * uIntensity;
  gl_FragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
}
`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform sampler2D tAO;
uniform sampler2D tDepth2;
uniform float uAO;
uniform float uDebug;
uniform float uExposure;
uniform float uBloom;
uniform float uRays;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform float uTime;
uniform float uHaze;
varying vec2 vUv;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);

  float ca = uCA * r2;
  vec3 col;
  col.r = texture2D(tScene, uv + d * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - d * ca).b;

  float ao = texture2D(tAO, uv).r;
  if (uDebug > 0.5) {
    if (uDebug < 1.5) { gl_FragColor = vec4(vec3(ao), 1.0); return; }
    if (uDebug < 2.5) {
      float d = texture2D(tDepth2, uv).x;
      gl_FragColor = vec4(vec3(pow(d, 60.0)), 1.0); return;
    }
    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); return;
  }
  col *= mix(1.0, ao, uAO);

  col += texture2D(tBloom, uv).rgb * uBloom;
  col += texture2D(tRays, uv).rgb * uRays * vec3(1.0, 0.87, 0.66);

  col *= uExposure;

  vec3 haze = vec3(0.68, 0.72, 0.62);
  col = mix(col, haze * (0.55 + r2 * 1.4), uHaze * (0.35 + r2));

  // single filmic curve for the whole frame (the scene pass renders linear)
  col = aces(col);

  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  float luma = dot(col, LW);
  // cool sky-bounce in the shadows, warm sun in the highlights
  col = mix(col * vec3(0.80, 0.90, 1.10), col, smoothstep(0.0, 0.42, luma));
  col = mix(col, col * vec3(1.07, 1.0, 0.90), smoothstep(0.45, 1.0, luma));
  col = mix(vec3(luma), col, 1.12);
  // gentle S-curve: restores the contrast ACES flattens
  vec3 sc = col * col * (3.0 - 2.0 * col);
  col = mix(col, sc, 0.22);
  col = clamp(col, 0.0, 1.0);
  col = pow(col, vec3(1.0 / 2.2));

  float vig = smoothstep(1.55, 0.30, length(d) * 1.15);
  col *= mix(1.0, vig, uVignette);

  float g = fract(sin(dot(uv * vec2(1234.5, 5678.9) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class PostFX {
  constructor(renderer, debugMode = 0) {
    this.debugMode = debugMode;
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad.frustumCulled = false;

    const rtOpts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.sceneDepth = new THREE.DepthTexture(2, 2);
    this.sceneDepth.type = THREE.UnsignedIntType;
    this.sceneDepth.minFilter = THREE.NearestFilter;
    this.sceneDepth.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: true, depthTexture: this.sceneDepth });
    this.rtAO = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtAOBlur = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtBright = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtBlurA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtBlurB = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtRayA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtRayB = new THREE.WebGLRenderTarget(2, 2, rtOpts);

    this.mBright = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.05 } },
    });
    this.mBlur = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.mRays = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: RAYS, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.7) },
        uDensity: { value: 0.55 }, uDecay: { value: 0.965 },
      },
    });
    this.mSSAO = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: SSAO, depthTest: false, depthWrite: false,
      uniforms: {
        tDepth: { value: this.sceneDepth },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 0.55 },
        uBias: { value: 0.035 },
        uIntensity: { value: 1.55 },
      },
    });
    this.mComposite = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tRays: { value: null },
        tAO: { value: null }, uAO: { value: 1.0 },
        tDepth2: { value: null }, uDebug: { value: 0 },
        uExposure: { value: 1.0 }, uBloom: { value: 0.26 }, uRays: { value: 1.0 },
        uVignette: { value: 0.30 }, uGrain: { value: 0.026 }, uCA: { value: 0.008 },
        uTime: { value: 0 }, uHaze: { value: 0.05 },
      },
    });
    this.sunUV = new THREE.Vector2(0.5, 0.7);
  }

  setSize(w, h) {
    this.width = w; this.height = h;
    const hw = Math.max(1, (w * 0.5) | 0), hh = Math.max(1, (h * 0.5) | 0);
    const qw = Math.max(1, (w * 0.25) | 0), qh = Math.max(1, (h * 0.25) | 0);
    this.rtScene.setSize(w, h);
    this.sceneDepth.image.width = w;
    this.sceneDepth.image.height = h;
    this.sceneDepth.needsUpdate = true;
    this.rtAO.setSize(hw, hh);
    this.rtAOBlur.setSize(hw, hh);
    this.ssaoRes = new THREE.Vector2(w, h);
    this.rtBright.setSize(hw, hh);
    this.rtBlurA.setSize(hw, hh);
    this.rtBlurB.setSize(hw, hh);
    this.rtRayA.setSize(qw, qh);
    this.rtRayB.setSize(qw, qh);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, dt, sunWorld, exposureMul = 1) {
    const r = this.renderer;

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // sun projection -> screen uv for god rays
    if (sunWorld) {
      const p = sunWorld.clone().project(camera);
      this.sunUV.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      const onScreen = p.z < 1 && this.sunUV.x > -0.35 && this.sunUV.x < 1.35 &&
        this.sunUV.y > -0.35 && this.sunUV.y < 1.35;
      this.mRays.uniforms.uSun.value.copy(this.sunUV);
      this.mRays.uniforms.uDensity.value = onScreen ? 0.62 : 0.0;
      this.mComposite.uniforms.uRays.value = onScreen ? 2.1 : 0.15;
    }

    // ambient occlusion
    this.mSSAO.uniforms.tDepth.value = this.sceneDepth;
    this.mSSAO.uniforms.uProj.value.copy(camera.projectionMatrix);
    this.mSSAO.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    if (this.ssaoRes) this.mSSAO.uniforms.uRes.value.copy(this.ssaoRes);
    this.mSSAO.uniforms.uRadius.value = 0.75;
    this.pass(this.mSSAO, this.rtAO);
    this.mBlur.uniforms.tDiffuse.value = this.rtAO.texture;
    this.mBlur.uniforms.uDir.value.set(2.0 / this.width, 0);
    this.pass(this.mBlur, this.rtAOBlur);
    this.mBlur.uniforms.tDiffuse.value = this.rtAOBlur.texture;
    this.mBlur.uniforms.uDir.value.set(0, 2.0 / this.height);
    this.pass(this.mBlur, this.rtAO);

    // bright pass
    this.mBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.pass(this.mBright, this.rtBright);

    // bloom: two separable blur passes at half res
    let src = this.rtBright;
    for (let i = 0; i < 2; i++) {
      this.mBlur.uniforms.tDiffuse.value = src.texture;
      this.mBlur.uniforms.uDir.value.set((1.4 + i * 2.2) / this.width, 0);
      this.pass(this.mBlur, this.rtBlurA);
      this.mBlur.uniforms.tDiffuse.value = this.rtBlurA.texture;
      this.mBlur.uniforms.uDir.value.set(0, (1.4 + i * 2.2) / this.height);
      this.pass(this.mBlur, this.rtBlurB);
      src = this.rtBlurB;
    }

    // volumetric-ish light shafts (radial blur of the bright buffer toward the sun)
    this.mRays.uniforms.tDiffuse.value = this.rtBright.texture;
    this.pass(this.mRays, this.rtRayA);
    this.mRays.uniforms.tDiffuse.value = this.rtRayA.texture;
    this.pass(this.mRays, this.rtRayB);

    // composite to screen
    const u = this.mComposite.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtBlurB.texture;
    u.tRays.value = this.rtRayB.texture;
    u.tAO.value = this.rtAO.texture;
    u.tDepth2.value = this.sceneDepth;
    u.uDebug.value = this.debugMode;
    u.uTime.value += dt;
    u.uExposure.value = 1.75 * exposureMul;
    this.pass(this.mComposite, null);
  }
}
