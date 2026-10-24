import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { animateBreeze } from './env/breeze.js';
import { gradientMap } from './toon.js';
import palmUrl from '../assets/models/coconut-palm.glb?url';
import umbrellaUrl from '../assets/models/beach-umbrella.glb?url';

const loader = new GLTFLoader();
const assets = new Map();
const urls = { palm: palmUrl, umbrella: umbrellaUrl };

// Load each file once; clones share geometry. Keep the procedural prop if loading fails.
export function upgradeIslandProp(parent, kind, { scale = 1, colors } = {}) {
  if (!assets.has(kind)) assets.set(kind, loader.loadAsync(urls[kind]));
  assets.get(kind).then(({ scene }) => {
    const model = scene.clone(true);
    const materials = new Map();
    model.traverse((object) => {
      if (!object.isMesh) return;
      const convert = (source) => {
        if (!materials.has(source)) {
          const color = source.color.clone();
          if (colors && source.name.startsWith('Canvas accent')) color.set(colors[0]);
          if (colors && source.name.startsWith('Canvas ivory')) color.set(colors[1]);
          materials.set(source, new THREE.MeshToonMaterial({
            name: source.name, color, gradientMap: gradientMap(), side: source.side,
          }));
        }
        return materials.get(source);
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(convert) : convert(object.material);
      object.castShadow = true;
      object.receiveShadow = true;
    });
    animateBreeze(model, kind);
    model.scale.setScalar(scale);
    // Hide only the fallback children: their animation references remain valid.
    for (const child of parent.children) child.visible = false;
    parent.add(model);
    parent.userData.assetLoaded = kind;
  }).catch((error) => console.warn(`Using fallback ${kind}:`, error));
}
