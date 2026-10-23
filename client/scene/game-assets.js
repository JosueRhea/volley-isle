import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gradientMap, withOutline } from './toon.js';
import bongo from '../assets/models/characters/bongo.glb?url';
import pinchy from '../assets/models/characters/pinchy.glb?url';
import pip from '../assets/models/characters/pip.glb?url';
import tiki from '../assets/models/characters/tiki.glb?url';
import mochi from '../assets/models/characters/mochi.glb?url';
import rocco from '../assets/models/characters/rocco.glb?url';
import ball from '../assets/models/match-volleyball.glb?url';
import post from '../assets/models/padded-net-post.glb?url';
import hut from '../assets/models/juice-hut.glb?url';
import bleachers from '../assets/models/wooden-bleachers.glb?url';

export const characterModels = [bongo, pinchy, pip, tiki, mochi, rocco];
const props = { ball, post, hut, bleachers };
const cache = new Map();
const loader = new GLTFLoader();

export async function loadGameModel(url, { teamColor, outline = false } = {}) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  const gltf = await cache.get(url);
  const root = gltf.scene.clone(true);
  const roles = new Map();
  const materials = new Map();
  const meshes = [];
  root.traverse((o) => {
    if (o.userData.role) roles.set(o.userData.role, o);
    if (o.isMesh) meshes.push(o);
  });
  const convert = (source) => {
    if (!materials.has(source)) {
      const color = source.color.clone();
      if (teamColor !== undefined && /^Team(?:\.|$)/.test(source.name)) color.set(teamColor);
      const flat = /^(Ink|White|Mouth|Tongue)(?:\.|$)/.test(source.name);
      const material = /^Trophy gold/.test(source.name) ? new THREE.MeshStandardMaterial({ color, metalness: .65, roughness: .3 })
        : flat ? new THREE.MeshBasicMaterial({ color, side: source.side })
        : new THREE.MeshToonMaterial({ color, side: source.side, gradientMap: gradientMap() });
      if (/^Lava/.test(source.name) && material.isMeshToonMaterial) {
        material.emissive.set(0xff5500);
        material.emissiveIntensity = 0.25;
      }
      materials.set(source, material);
    }
    return materials.get(source);
  };
  // Add outlines after traversal so their meshes aren't visited recursively.
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (outline) withOutline(mesh, 0.009);
  }
  return { root, roles, dispose: () => { for (const m of materials.values()) m.dispose(); } };
}

export function upgradeGameProp(parent, kind, options = {}) {
  return loadGameModel(props[kind], options).then(({ root }) => {
    for (const child of parent.children) child.visible = false;
    parent.add(root);
    parent.userData.assetLoaded = kind;
    return root;
  }).catch((error) => { console.warn(`Using fallback ${kind}:`, error); return null; });
}
