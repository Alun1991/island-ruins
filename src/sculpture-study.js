import * as THREE from '../vendor/three.module.js';

export function createSculptureStudy() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c131a);
  scene.fog = new THREE.FogExp2(0x0c131a, 0.115);

  // One continuous cast form, with a broad face and a narrow rolled edge.
  const rings = 128, sides = 32;
  const positions = [], colors = [], indices = [];
  const bronze = new THREE.Color(0x967758);
  const patina = new THREE.Color(0x3b6764);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings * Math.PI * 2;
    const center = new THREE.Vector3(
      0.56 * Math.sin(t) + 0.16 * Math.cos(2 * t),
      0.91 * Math.cos(t),
      0.21 * Math.sin(2 * t) + 0.12 * Math.sin(t),
    );
    const radial = new THREE.Vector3(Math.sin(t), Math.cos(t), 0);
    const twist = 0.7 * Math.sin(t) + 0.67 * Math.cos(2 * t);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const wide = Math.cos(a) * (0.23 + 0.07 * Math.sin(t + 0.3));
      const thin = Math.sin(a) * 0.102;
      const r = wide * Math.cos(twist) - thin * Math.sin(twist);
      const z = wide * Math.sin(twist) + thin * Math.cos(twist);
      const ripple = Math.sin(29 * t + 9 * a) * Math.sin(17 * t - 5 * a);
      positions.push(center.x + radial.x*r, center.y + radial.y*r, center.z + z + ripple*0.002);
      const oxidation = THREE.MathUtils.clamp(0.50 + 0.25*Math.sin(6*t+2*a) + 0.12*ripple, 0, 1);
      const tint = bronze.clone().lerp(patina, oxidation);
      colors.push(tint.r, tint.g, tint.b);
      if (i < rings && j < sides) {
        const k = i*(sides+1)+j, next = k+sides+1;
        indices.push(k, k+1, next, k+1, next+1, next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const first = i*(sides+1), last = first+sides;
    const sum = new THREE.Vector3().fromBufferAttribute(normals,first)
      .add(new THREE.Vector3().fromBufferAttribute(normals,last)).normalize();
    for (const k of [first,last]) normals.setXYZ(k,sum.x,sum.y,sum.z);
  }
  for (let j = 0; j <= sides; j++) {
    const last = rings*(sides+1)+j;
    const sum = new THREE.Vector3().fromBufferAttribute(normals,j)
      .add(new THREE.Vector3().fromBufferAttribute(normals,last)).normalize();
    for (const k of [j,last]) normals.setXYZ(k,sum.x,sum.y,sum.z);
  }
  geometry.computeBoundingBox();
  const sculpture = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.42, metalness: 0.54, clearcoat: 0.22,
  }));
  sculpture.position.y = 0.66 - geometry.boundingBox.min.y;
  sculpture.castShadow = sculpture.receiveShadow = true;
  scene.add(sculpture);

  const basalt = new THREE.MeshStandardMaterial({ color: 0x333b41, roughness: 0.89 });
  for (const [radius, height, y] of [[0.86,0.10,0.05],[0.77,0.49,0.345],[0.80,0.07,0.625]]) {
    const step = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,72),basalt);
    step.position.y = y;
    step.castShadow = step.receiveShadow = true;
    scene.add(step);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90,90), basalt);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  const key = new THREE.DirectionalLight(0xd3e8ff, 3.0);
  key.position.set(-3.5,5.2,3.3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera,{left:-2.2,right:2.2,top:2.8,bottom:-2.2});
  key.shadow.normalBias = 0.019;
  const rim = new THREE.DirectionalLight(0xffcc99, 1.8);
  rim.position.set(3,3.5,-4);
  const fill = new THREE.DirectionalLight(0xbdd3e6, 0.85);
  fill.position.set(0.7, 2.1, 4.0);
  scene.add(key, rim, fill, new THREE.HemisphereLight(0xc4deff,0x444043,0.72));

  return { scene, focus: new THREE.Vector3(0,1.31,0) };
}
