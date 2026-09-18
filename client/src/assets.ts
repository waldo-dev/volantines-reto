import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const BASE = import.meta.env.BASE_URL;
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const gltfCache = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, Promise<THREE.Texture | null>>();

export const assetUrl = (path: string) => `${BASE}${path}`;

/** Carga un GLB una sola vez; las siguientes llamadas reciben la misma promesa. */
export function loadGLB(path: string): Promise<GLTF> {
  let p = gltfCache.get(path);
  if (!p) {
    p = gltfLoader.loadAsync(assetUrl(path));
    gltfCache.set(path, p);
  }
  return p;
}

/** Carga una textura de color (sRGB). Devuelve null si falla, para poder usar un respaldo. */
export function loadTexture(path: string, repeat = false): Promise<THREE.Texture | null> {
  const key = `${path}|${repeat}`;
  let p = texCache.get(key);
  if (!p) {
    p = texLoader
      .loadAsync(assetUrl(path))
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        return t;
      })
      .catch(() => null);
    texCache.set(key, p);
  }
  return p;
}

const lambertCache = new Map<THREE.Material, THREE.Material>();
/**
 * Pasa los materiales PBR de los GLB a Lambert (mate y más liviano).
 * Varios modelos de Kenney no traen metalness, y glTF lo asume en 1: sin mapa de entorno se verían negros.
 */
export function toLambert(material: THREE.Material): THREE.Material {
  const src = material as THREE.MeshStandardMaterial;
  if (!src.isMeshStandardMaterial) return material;
  let out = lambertCache.get(material);
  if (!out) {
    out = new THREE.MeshLambertMaterial({
      color: src.color,
      map: src.map,
      vertexColors: src.vertexColors,
      side: src.side,
      transparent: src.transparent,
      opacity: src.opacity,
      alphaTest: src.alphaTest,
    });
    lambertCache.set(material, out);
  }
  return out;
}

export interface MeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Extrae las mallas de un GLB con su transformación aplicada, listas para instanciar. */
export async function meshParts(path: string): Promise<MeshPart[]> {
  const gltf = await loadGLB(path);
  const parts: MeshPart[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geometry = m.geometry.clone();
    geometry.applyMatrix4(m.matrixWorld);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length === 1) {
      parts.push({ geometry, material: toLambert(mats[0]) });
    } else {
      // Una parte por grupo de material
      for (const g of geometry.groups) {
        const sub = geometry.clone();
        sub.setIndex(Array.from((geometry.index!.array as ArrayLike<number>)).slice(g.start, g.start + g.count));
        sub.clearGroups();
        parts.push({ geometry: sub, material: toLambert(mats[g.materialIndex ?? 0]) });
      }
    }
  });
  return parts;
}

/** Crea InstancedMesh (una por parte del modelo) con las matrices dadas. */
export async function instanced(path: string, matrices: THREE.Matrix4[], shadows: boolean, colors?: THREE.Color[]) {
  const group = new THREE.Group();
  if (matrices.length === 0) return group;
  const parts = await meshParts(path);
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
