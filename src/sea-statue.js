import * as T from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export function seaStatue() {
  const mount = new T.Group();
  new GLTFLoader().load('assets/statues/dragon.glb', ({ scene }) => {
    const bronze = new T.MeshStandardMaterial({
      vertexColors: true, color: 0xffffff, roughness: 0.54, metalness: 0.27,
    });
    scene.rotation.y = -0.20;
    scene.traverse(part => {
      if (!part.isMesh) return;
      part.material = bronze;
      part.castShadow = part.receiveShadow = true;
    });
    mount.add(scene);
  });
  return mount;
}
