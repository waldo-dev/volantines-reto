import * as THREE from 'three';
import { cableSegments, groundHeight, pondOf, type MapDef, type MapId, type V3 } from '@volantines/shared';
import { instanced, loadTexture } from '../assets';

/** Colores y luz de cada mapa. */
interface Theme {
  skyTop: string;
  skyHorizon: string;
  fogNear: number;
  sun: { color: string; intensity: number; x: number; y: number; z: number };
  hemi: { sky: string; ground: string; intensity: number };
  /** Tinte del pasto (se multiplica por la textura). */
  grass: [number, number, number];
  andes: boolean;
}

const THEMES: Record<MapId, Theme> = {
  cerro: {
    skyTop: '#3f86d4',
    skyHorizon: '#cfe5f5',
    fogNear: 200,
    sun: { color: '#fff4de', intensity: 2.2, x: -60, y: 120, z: 40 },
    hemi: { sky: '#d8ecff', ground: '#5d7b3a', intensity: 1.1 },
    grass: [1, 1, 1],
    andes: true,
  },
  parque: {
    skyTop: '#3a8ae0',
    skyHorizon: '#d9ecfa',
    fogNear: 220,
    sun: { color: '#fff4de', intensity: 2.3, x: -60, y: 130, z: 30 },
    hemi: { sky: '#dcefff', ground: '#6a8a3c', intensity: 1.15 },
    grass: [0.95, 1.05, 0.9],
    andes: true,
  },
  campo: {
    skyTop: '#2f3f78',
    skyHorizon: '#f6a466',
    fogNear: 160,
    sun: { color: '#ffae66', intensity: 1.9, x: -160, y: 45, z: 60 },
    hemi: { sky: '#ffd2a8', ground: '#4d5a2c', intensity: 0.95 },
    grass: [1.12, 0.98, 0.72],
    andes: true,
  },
  playa: {
    skyTop: '#2f8ee6',
    skyHorizon: '#dff2fb',
    fogNear: 260,
    sun: { color: '#fffaf0', intensity: 2.5, x: -40, y: 140, z: 50 },
    hemi: { sky: '#e6f5ff', ground: '#c9b58a', intensity: 1.2 },
    grass: [1.05, 1.05, 0.9],
    andes: false,
  },
  valparaiso: {
    skyTop: '#4a86c8',
    skyHorizon: '#d6e4ee',
    fogNear: 170,
    sun: { color: '#fff1d8', intensity: 2.1, x: -70, y: 110, z: 50 },
    hemi: { sky: '#d6e6f5', ground: '#6b6a4a', intensity: 1.1 },
    grass: [1.02, 0.98, 0.88],
    andes: true,
  },
};

/** Generador pseudoaleatorio con semilla, para que el mundo sea igual para todos. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Trazado del mundo ---
type P2 = [number, number];
/** Senderos de tierra de El Cerro: del cerro a la fonda, a la laguna y al pueblo. */
const CERRO_PATHS: P2[][] = [
  [[0, 0], [-18, 16], [-40, 34], [-62, 44]],
  [[0, 0], [22, -18], [50, -40], [72, -58]],
  [[-40, 34], [-22, 70], [10, 100], [55, 118], [100, 126]],
];
const MAP_PATHS: Record<MapId, P2[][]> = {
  cerro: CERRO_PATHS,
  parque: [
    [[-140, -12], [140, -12]],
    [[-140, 12], [140, 12]],
    [[-12, -140], [-12, 140]],
    [[-70, 60], [-12, 12]],
  ],
  campo: [
    [[0, 0], [30, 30], [60, 80], [70, 160]],
    [[-160, 50], [-60, 40], [30, 30], [180, 20]],
  ],
  playa: [[[0, 0], [60, 0], [140, -10]]],
  valparaiso: [
    [[0, 0], [40, -20], [80, -50]],
    [[0, 0], [45, 30], [95, 70]],
    [[-60, -140], [-60, 140]],
  ],
};
/** Senderos del mapa que se está construyendo. */
let PATHS: P2[][] = CERRO_PATHS;
/** Franja de arena desde la orilla del mar: [inicio del pasto, pasto completo] en x (null sin mar). */
let sandy: [number, number] | null = null;
const FONDA = { x: -66, z: 58 };
const VILLAGE = { x: 70, z: 125 };
const SPAWN_CLEAR = 16;

function distToSegment(x: number, z: number, a: P2, b: P2) {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t));
}

export function distToPath(x: number, z: number) {
  let d = Infinity;
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) d = Math.min(d, distToSegment(x, z, path[i], path[i + 1]));
  return d;
}

const inPond = (x: number, z: number, margin = 0) => {
  const p = pondOf();
  return !!p && Math.hypot(x - p.x, z - p.z) < p.r + margin;
};

export interface WorldQuality {
  shadows: boolean;
  mobile: boolean;
  /** Cuánto paisaje (árboles, pasto, casas): 1 = todo. Sin él, según si es teléfono. */
  density?: number;
}

export interface World {
  sun: THREE.DirectionalLight;
  update(dt: number, wind: V3 & { angle: number; speed: number }, focus: V3, time: number): void;
  /** Saca el mundo de la escena (para cambiar de mapa). */
  dispose(): void;
}

/** Construye el mundo del mapa (que ya tiene que estar activo con `useMap`). */
export function createWorld(scene: THREE.Scene, q: WorldQuality, map: MapDef): World {
  const rand = mulberry32(18_09);
  const density = q.density ?? (q.mobile ? 0.55 : 1);
  const theme = THEMES[map.id];
  const SKY_TOP = new THREE.Color(theme.skyTop);
  const SKY_HORIZON = new THREE.Color(theme.skyHorizon);
  PATHS = MAP_PATHS[map.id];
  // La playa es toda arena hasta el médano; en Valparaíso solo una franja en la costa
  sandy = map.sea ? (map.id === 'playa' ? [map.sea.x + 90, map.sea.x + 125] : [map.sea.x + 12, map.sea.x + 26]) : null;
  // Todo el mundo cuelga de este grupo: cambiar de mapa es sacarlo y armar otro
  const root = new THREE.Group();
  scene.add(root);

  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON, theme.fogNear, 1150);

  // Cielo degradado
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
        void main(){ float h = clamp(normalize(vPos).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0); }`,
    }),
  );
  sky.renderOrder = -1;
  root.add(sky);

  // Luces
  root.add(new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  const sunOffset = new THREE.Vector3(theme.sun.x, theme.sun.y, theme.sun.z);
  sun.position.copy(sunOffset);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = c.bottom = -45;
    c.right = c.top = 45;
    c.near = 10;
    c.far = 320;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
  }
  root.add(sun, sun.target);

  createTerrain(root, q, theme);
  createWater(root, map);
  if (theme.andes) createAndes(root, rand);
  const clouds = createClouds(root, rand);

  // Banderas chilenas: muestran hacia dónde sopla el viento
  const flagSpots: [number, number, number][] =
    map.id === 'cerro' ? [[6, -14, 6], [FONDA.x - 10, FONDA.z - 8, 7], [FONDA.x + 12, FONDA.z + 6, 7]] : [[6, -14, 6], [-8, 14, 6]];
  const flags = flagSpots.map(([x, z, h]) => createFlag(x, z, h));
  for (const f of flags) root.add(f.group);
  if (map.id === 'cerro') createGarlands(root, FONDA);

  const bonus = map.bonus ? createBonusZone(root, map.bonus) : null;
  if (map.cables.length) createCables(root, map);

  if (map.id === 'cerro') void populate(root, q, rand, density);
  else void populateMap(root, q, rand, density, map);

  return {
    sun,
    dispose() {
      scene.remove(root);
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
    update(dt, wind, focus, time) {
      // La luz del sol sigue al jugador para que las sombras cercanas se vean nítidas
      sun.position.set(focus.x + sunOffset.x, focus.y + sunOffset.y, focus.z + sunOffset.z);
      sun.target.position.set(focus.x, focus.y, focus.z);
      bonus?.update(time);
      for (const c of clouds) {
        c.position.x += wind.x * dt * 0.8;
        c.position.z += wind.z * dt * 0.8;
        if (c.position.x > 700) c.position.x -= 1400;
        if (c.position.x < -700) c.position.x += 1400;
        if (c.position.z > 700) c.position.z -= 1400;
        if (c.position.z < -700) c.position.z += 1400;
      }
      for (const f of flags) f.update(wind.angle, wind.speed, time);
    },
  };
}

// --- Terreno ---

/**
 * Terreno en dos mallas: una fina cerca del centro (senderos nítidos) y una gruesa hasta el horizonte.
 * Textura de pasto con mezcla de tierra en los senderos (atributo `pathMask`).
 */
function createTerrain(scene: THREE.Object3D, q: WorldQuality, theme: Theme) {
  const grassFallback = new THREE.DataTexture(new Uint8Array([120, 170, 70, 255]), 1, 1);
  grassFallback.needsUpdate = true;
  const dirtFallback = new THREE.DataTexture(new Uint8Array([190, 160, 110, 255]), 1, 1);
  dirtFallback.needsUpdate = true;
  const uniforms = { dirtMap: { value: dirtFallback as THREE.Texture } };

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: grassFallback });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dirtMap = uniforms.dirtMap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float pathMask;\nvarying float vPath;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPath = pathMask;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D dirtMap;\nvarying float vPath;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, texture2D(dirtMap, vMapUv).rgb, vPath);',
      );
  };
  void loadTexture('textures/grass.webp', true).then((t) => {
    if (t) {
      material.map = t;
      material.needsUpdate = true;
    }
  });
  void loadTexture('textures/dirt.webp', true).then((t) => {
    if (t) uniforms.dirtMap.value = t;
  });

  const INNER = 204; // mitad del lado de la malla fina (múltiplo de la grilla gruesa de 12 m)
  const buildGrid = (half: number, segs: number, hole: number) => {
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const mask = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = groundHeight(x, z);
      // La malla gruesa se hunde bajo la fina para no taparla
      if (hole > 0 && Math.abs(x) < hole && Math.abs(z) < hole) y -= 4;
      pos.setY(i, y);
      uv.setXY(i, x / 7, z / 7);
      // Tinte suave: manchas más secas y más verdes
      const n = 0.5 + 0.5 * Math.sin(x * 0.045 + Math.cos(z * 0.035) * 2) * Math.cos(z * 0.06);
      const dry = y > 6.5 ? Math.min(1, (y - 6.5) / 3) * 0.25 : 0;
      const shore = inPond(x, z, 6) ? 0.25 : 0;
      colors[i * 3] = (0.9 + 0.18 * n + dry + shore) * theme.grass[0];
      colors[i * 3 + 1] = (0.95 + 0.1 * n + dry * 0.6 + shore * 0.5) * theme.grass[1];
      colors[i * 3 + 2] = (0.85 + 0.05 * n + shore * 0.2) * theme.grass[2];
      const d = distToPath(x, z);
      mask[i] = hole === 0 ? 1 - THREE.MathUtils.smoothstep(d, 1.2, 3.2) : 0;
      if (inPond(x, z, 3)) mask[i] = Math.max(mask[i], 0.7); // orilla de tierra
      // Arena: desde el mar hasta un poco pasado el lugar para encumbrar
      if (sandy) mask[i] = Math.max(mask[i], 1 - THREE.MathUtils.smoothstep(x, sandy[0], sandy[1]));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('pathMask', new THREE.BufferAttribute(mask, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = q.shadows;
    scene.add(mesh);
  };
  buildGrid(INNER, q.mobile ? 136 : 204, 0);
  buildGrid(960, 160, INNER);
}

function createWater(scene: THREE.Object3D, map: MapDef) {
  const mat = new THREE.MeshPhongMaterial({ color: '#4d97c9', shininess: 90, specular: '#cfe8ff', transparent: true, opacity: 0.88 });
  if (map.pond) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(map.pond.r + 2, 40), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(map.pond.x, map.pond.level, map.pond.z);
    scene.add(water);
  }
  if (map.sea) {
    // El mar: un plano grande desde la orilla hacia -x
    const W = 2400;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshPhongMaterial({ color: '#2f7fb8', shininess: 110, specular: '#d8f0ff' }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(map.sea.x + 20 - W / 2, map.sea.level, 0);
    scene.add(sea);
  }
}

function createAndes(scene: THREE.Object3D, rand: () => number) {
  const mountainMat = new THREE.MeshLambertMaterial({ color: '#7d8fa8', flatShading: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: '#f3f6fa', flatShading: true });
  for (let i = 0; i < 16; i++) {
    const h = 160 + rand() * 170;
    const r = 110 + rand() * 90;
    const x = -800 + i * 105 + rand() * 40;
    const z = -720 - rand() * 120;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mountainMat);
    m.position.set(x, h / 2 - 10, z);
    m.rotation.y = rand() * Math.PI;
    const capH = h * 0.3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3 + 1, capH, 7), snowMat);
    cap.position.y = h / 2 - capH / 2 + 0.5;
    m.add(cap);
    scene.add(m);
  }
}

function createClouds(scene: THREE.Object3D, rand: () => number) {
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#dfe9f3', emissiveIntensity: 0.6, flatShading: true });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group();
    const parts = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < parts; j++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      const r = 8 + rand() * 8;
      m.scale.set(r * 1.4, r * 0.7, r);
      m.position.set(j * 10 - parts * 5, rand() * 4, (rand() - 0.5) * 10);
      g.add(m);
    }
    g.position.set((rand() - 0.5) * 1200, 110 + rand() * 60, (rand() - 0.5) * 1200);
    clouds.push(g);
    scene.add(g);
  }
  return clouds;
}

/** Guirnaldas de banderines tricolor sobre una fonda, en triángulos instanciados. */
function createGarlands(scene: THREE.Object3D, FONDA: { x: number; z: number }) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.45, 0], 3));
  tri.computeVertexNormals();
  const poles: P2[] = [
    [FONDA.x - 14, FONDA.z - 10],
    [FONDA.x + 14, FONDA.z - 10],
    [FONDA.x + 14, FONDA.z + 12],
    [FONDA.x - 14, FONDA.z + 12],
  ];
  const lines: [P2, P2][] = [
    [poles[0], poles[1]],
    [poles[1], poles[2]],
    [poles[2], poles[3]],
    [poles[3], poles[0]],
    [poles[0], poles[2]],
    [poles[1], poles[3]],
  ];
  const colors = ['#d52b1e', '#ffffff', '#0039a6'].map((c) => new THREE.Color(c));
  const matrices: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const POLE_H = 6;
  const poleMat = new THREE.MeshLambertMaterial({ color: '#7a5a3a' });
  for (const [x, z] of poles) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, POLE_H, 6), poleMat);
    pole.position.set(x, groundHeight(x, z) + POLE_H / 2, z);
    pole.castShadow = true;
    scene.add(pole);
  }
  for (const [a, b] of lines) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.floor(len / 0.8);
    const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
    quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      const sag = Math.sin(t * Math.PI) * 1.4;
      const ya = groundHeight(a[0], a[1]) + POLE_H - 0.2;
      const yb = groundHeight(b[0], b[1]) + POLE_H - 0.2;
      m.compose(new THREE.Vector3(x, ya + (yb - ya) * t - sag, z), quat, one);
      matrices.push(m.clone());
      cols.push(colors[i % 3]);
    }
  }
  const mesh = new THREE.InstancedMesh(tri, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), matrices.length);
  matrices.forEach((mm, i) => {
    mesh.setMatrixAt(i, mm);
    mesh.setColorAt(i, cols[i]);
  });
  scene.add(mesh);
}

// --- Vegetación, casas y la fonda (modelos CC0 de Kenney, instanciados) ---

async function populate(scene: THREE.Object3D, q: WorldQuality, rand: () => number, density: number) {
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpP = new THREE.Vector3();
  const at = (x: number, z: number, scale: number | [number, number, number], yaw = rand() * Math.PI * 2, lift = 0) => {
    tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    if (typeof scale === 'number') tmpS.setScalar(scale);
    else tmpS.set(...scale);
    return new THREE.Matrix4().compose(tmpP.set(x, groundHeight(x, z) + lift, z), tmpQ, tmpS);
  };
  const scatter = (count: number, radius: number, ok: (x: number, z: number) => boolean) => {
    const out: P2[] = [];
    for (let tries = 0; out.length < count && tries < count * 20; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (ok(x, z)) out.push([x, z]);
    }
    return out;
  };
  const free = (clear: number, pathGap: number) => (x: number, z: number) =>
    Math.hypot(x, z) > clear &&
    distToPath(x, z) > pathGap &&
    !inPond(x, z, 4) &&
    Math.hypot(x - FONDA.x, z - FONDA.z) > 22 &&
    Math.hypot(x - VILLAGE.x, z - VILLAGE.z) > 45;

  const add = async (path: string, mats: THREE.Matrix4[], shadows = q.shadows) => {
    scene.add(await instanced(path, mats, shadows));
  };
  const jobs: Promise<void>[] = [];

  // Álamos en fila junto al sendero al pueblo: postal del campo chileno
  const alamos: THREE.Matrix4[] = [];
  const road = PATHS[2];
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, az] = road[i];
    const [bx, bz] = road[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (let d = 4; d < len; d += 9) {
      const x = ax + ((bx - ax) * d) / len;
      const z = az + ((bz - az) * d) / len;
      for (const side of [-1, 1]) {
        const s = 3.6 + rand() * 0.8;
        alamos.push(at(x + nx * side * 5.5, z + nz * side * 5.5, [s, s * 2.4, s]));
      }
    }
  }
  // Cortina de álamos al oeste
  for (let z = -160; z < 160; z += 10) {
    const s = 3.6 + rand();
    alamos.push(at(-125 + rand() * 2, z, [s, s * 2.5, s]));
  }
  jobs.push(add('models/nature/tree_cone.glb', alamos));

  // Árboles sueltos
  const trees = ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA'];
  const treeSpots = scatter(Math.round(150 * density), 330, free(SPAWN_CLEAR + 12, 6));
  trees.forEach((name, t) => {
    const mats = treeSpots.filter((_, i) => i % trees.length === t).map(([x, z]) => at(x, z, 4.5 + rand() * 2.5));
    jobs.push(add(`models/nature/${name}.glb`, mats));
  });

  // Arbustos, rocas, flores y pasto
  const bushes = scatter(Math.round(120 * density), 260, free(SPAWN_CLEAR, 3));
  jobs.push(add('models/nature/plant_bush.glb', bushes.slice(0, 60).map(([x, z]) => at(x, z, 4 + rand() * 3))));
  jobs.push(add('models/nature/plant_bushDetailed.glb', bushes.slice(60).map(([x, z]) => at(x, z, 3 + rand() * 2))));
  const rocks = scatter(Math.round(50 * density), 300, free(SPAWN_CLEAR, 3));
  jobs.push(add('models/nature/rock_largeA.glb', rocks.slice(0, 18).map(([x, z]) => at(x, z, 3 + rand() * 4, undefined, -0.2))));
  jobs.push(add('models/nature/rock_largeB.glb', rocks.slice(18, 34).map(([x, z]) => at(x, z, 3 + rand() * 3, undefined, -0.2))));
  jobs.push(add('models/nature/rock_smallA.glb', rocks.slice(34).map(([x, z]) => at(x, z, 3 + rand() * 2))));
  // Rocas alrededor de la laguna
  const shore: THREE.Matrix4[] = [];
  const pond = pondOf();
  for (let i = 0; pond && i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = pond.r + 1 + rand() * 3;
    shore.push(at(pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r, 2 + rand() * 3, undefined, -0.3));
  }
  jobs.push(add('models/nature/rock_smallC.glb', shore));

  // Flores en manchones
  const flowerKinds = ['flower_redA', 'flower_yellowA', 'flower_purpleA'];
  const patches = scatter(Math.round(28 * density), 200, free(6, 2.5));
  flowerKinds.forEach((name, k) => {
    const mats: THREE.Matrix4[] = [];
    patches.forEach(([px, pz], p) => {
      if (p % 3 !== k) return;
      for (let i = 0; i < 9; i++) {
        const x = px + (rand() - 0.5) * 7;
        const z = pz + (rand() - 0.5) * 7;
        if (distToPath(x, z) > 2 && !inPond(x, z, 2)) mats.push(at(x, z, 2.2 + rand()));
      }
    });
    jobs.push(add(`models/nature/${name}.glb`, mats, false));
  });
  const grass = scatter(Math.round(700 * density), 150, (x, z) => distToPath(x, z) > 2 && !inPond(x, z, 1));
  jobs.push(add('models/nature/grass.glb', grass.slice(0, grass.length / 2).map(([x, z]) => at(x, z, 2.5 + rand() * 1.5)), false));
  jobs.push(add('models/nature/grass_large.glb', grass.slice(grass.length / 2).map(([x, z]) => at(x, z, 2.5 + rand() * 1.5)), false));

  // Pueblo: casas de Kenney con techo de teja
  const houseTypes = ['a', 'c', 'f', 'h', 'k', 'm', 'p', 's'];
  const housePlan: { type: string; x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const row = i < 6 ? -1 : 1;
    const x = VILLAGE.x - 40 + (i % 6) * 17 + rand() * 3;
    const z = VILLAGE.z + row * 17 + rand() * 3;
    housePlan.push({ type: houseTypes[i % houseTypes.length], x, z, yaw: row < 0 ? Math.PI : 0 });
  }
  // Casas sueltas en el campo
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    housePlan.push({ type: houseTypes[(i * 3) % 8], x: Math.cos(a) * 120, z: Math.sin(a) * 120, yaw: rand() * Math.PI * 2 });
  }
  for (const type of houseTypes) {
    const mats = housePlan.filter((h) => h.type === type).map((h) => at(h.x, h.z, 7, h.yaw, -0.3));
    jobs.push(add(`models/houses/building-type-${type}.glb`, mats));
  }

  // Cercos: potrero de choclos junto al sendero y cerco del pueblo
  const fences: THREE.Matrix4[] = [];
  const fenceLine = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = -Math.atan2(bz - az, bx - ax);
    for (let d = 1.5; d < len; d += 3) {
      fences.push(at(ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len, 3, yaw));
    }
  };
  const field = { x: 30, z: 60, w: 36, d: 24 };
  fenceLine(field.x, field.z, field.x + field.w, field.z);
  fenceLine(field.x + field.w, field.z, field.x + field.w, field.z + field.d);
  fenceLine(field.x + field.w, field.z + field.d, field.x, field.z + field.d);
  fenceLine(field.x, field.z + field.d, field.x, field.z + 4);
  fenceLine(VILLAGE.x - 50, VILLAGE.z - 30, VILLAGE.x + 60, VILLAGE.z - 30);
  jobs.push(add('models/nature/fence_simple.glb', fences));
  const corn: THREE.Matrix4[] = [];
  for (let x = field.x + 3; x < field.x + field.w - 2; x += 2.4 / density) {
    for (let z = field.z + 3; z < field.z + field.d - 2; z += 3) corn.push(at(x + rand() * 0.4, z + rand() * 0.4, 1.7 + rand() * 0.3));
  }
  jobs.push(add('models/nature/crops_cornStageD.glb', corn, false));

  // Fonda dieciochera: ramadas (carpas), fogata, troncos para sentarse y un letrero
  const tents = [
    at(FONDA.x - 7, FONDA.z - 4, 7, 0.3),
    at(FONDA.x + 7, FONDA.z - 3, 7, -0.2),
    at(FONDA.x, FONDA.z + 8, 7, Math.PI),
  ];
  jobs.push(add('models/nature/tent_detailedOpen.glb', tents));
  jobs.push(add('models/nature/campfire_stones.glb', [at(FONDA.x, FONDA.z, 3)]));
  jobs.push(
    add('models/nature/log.glb', [at(FONDA.x - 3, FONDA.z + 1.5, 3, 0.2), at(FONDA.x + 3, FONDA.z - 1.5, 3, 1.4), at(FONDA.x + 1, FONDA.z + 3.5, 3, 2.6)]),
  );
  jobs.push(add('models/nature/sign.glb', [at(-38, 30, 3, 0.9), at(46, -36, 3, -0.7)]));
  jobs.push(add('models/nature/stump_round.glb', scatter(10, 120, free(SPAWN_CLEAR, 4)).map(([x, z]) => at(x, z, 3))));

  await Promise.allSettled(jobs);
}

// --- Banderas ---

function createFlag(x: number, z: number, height: number) {
  const group = new THREE.Group();
  group.position.set(x, groundHeight(x, z), z);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, height, 6),
    new THREE.MeshLambertMaterial({ color: '#d9d9d9' }),
  );
  pole.position.y = height / 2;
  pole.castShadow = true;
  group.add(pole);

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 192, 64);
  ctx.fillStyle = '#d52b1e';
  ctx.fillRect(0, 64, 192, 64);
  ctx.fillStyle = '#0039a6';
  ctx.fillRect(0, 0, 64, 64);
  drawStar(ctx, 32, 32, 18, '#ffffff');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const W = 1.8;
  const H = 1.2;
  const geo = new THREE.PlaneGeometry(W, H, 12, 4);
  geo.translate(W / 2, 0, 0);
  const base = (geo.attributes.position as THREE.BufferAttribute).array.slice();
  const cloth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  const pivot = new THREE.Group();
  pivot.position.y = height - 0.7;
  pivot.add(cloth);
  group.add(pivot);

  return {
    group,
    update(angle: number, speed: number, time: number) {
      pivot.rotation.y = -angle;
      const attr = geo.attributes.position as THREE.BufferAttribute;
      const amp = 0.06 + Math.min(0.12, speed * 0.012);
      for (let i = 0; i < attr.count; i++) {
        const px = base[i * 3];
        const py = base[i * 3 + 1];
        attr.setXYZ(i, px, py - px * 0.04 * (8 - Math.min(8, speed)), Math.sin(px * 3 - time * (4 + speed)) * amp * px);
      }
      attr.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

export function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// --- Zona de bono y cables (fase 4) ---

/** Zona de bono: un cilindro dorado y transparente en el cielo, con anillos que giran. */
function createBonusZone(scene: THREE.Object3D, b: NonNullable<MapDef['bonus']>) {
  const group = new THREE.Group();
  group.position.set(b.x, b.y0, b.z);
  const h = b.y1 - b.y0;
  const wallMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, h, 40, 1, true), wallMat);
  wall.position.y = h / 2;
  wall.renderOrder = 3;
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.7, depthWrite: false });
  const rings = [0, h].map((y) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r, 0.25, 6, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
    return ring;
  });
  group.add(wall);
  scene.add(group);
  return {
    update(time: number) {
      wallMat.opacity = 0.08 + 0.05 * Math.sin(time * 2);
      for (const r of rings) r.rotation.z = time * 0.3;
    },
  };
}

/** Postes y cables del tendido eléctrico (los mismos tramos que usa la física). */
function createCables(scene: THREE.Object3D, map: MapDef) {
  const segs = cableSegments(map, groundHeight);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#5b4a3a' });
  const wireMat = new THREE.LineBasicMaterial({ color: '#1d1d1d' });
  const poles = new Map<string, V3>();
  for (const s of segs) for (const p of [s.a, s.b]) poles.set(`${p.x.toFixed(1)},${p.z.toFixed(1)}`, p);
  for (const p of poles.values()) {
    const base = groundHeight(p.x, p.z);
    const h = p.y - base + 1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, h, 6), poleMat);
    pole.position.set(p.x, base + h / 2, p.z);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), poleMat);
    arm.position.set(p.x, p.y + 0.2, p.z);
    scene.add(pole, arm);
  }
  for (const s of segs) {
    // Un poco de comba para que se vea como cable (la física usa el tramo recto)
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector3(s.a.x + (s.b.x - s.a.x) * t, s.a.y + (s.b.y - s.a.y) * t - Math.sin(t * Math.PI) * 0.5, s.a.z + (s.b.z - s.a.z) * t));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
  }
}

// --- Decoración de los mapas nuevos ---

async function populateMap(scene: THREE.Object3D, q: WorldQuality, rand: () => number, density: number, map: MapDef) {
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpP = new THREE.Vector3();
  const at = (x: number, z: number, scale: number | [number, number, number], yaw = rand() * Math.PI * 2, lift = 0) => {
    tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    if (typeof scale === 'number') tmpS.setScalar(scale);
    else tmpS.set(...scale);
    return new THREE.Matrix4().compose(tmpP.set(x, groundHeight(x, z) + lift, z), tmpQ, tmpS);
  };
  const scatter = (count: number, radius: number, ok: (x: number, z: number) => boolean) => {
    const out: P2[] = [];
    for (let tries = 0; out.length < count && tries < count * 20; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (ok(x, z)) out.push([x, z]);
    }
    return out;
  };
  const dry = (x: number, z: number) => !inPond(x, z, 4) && (!map.sea || x > map.sea.x + 8);
  const free = (clear: number, pathGap: number) => (x: number, z: number) => Math.hypot(x, z) > clear && distToPath(x, z) > pathGap && dry(x, z);
  const jobs: Promise<void>[] = [];
  const add = (path: string, mats: THREE.Matrix4[], shadows = q.shadows, colors?: THREE.Color[]) =>
    jobs.push(instanced(path, mats, shadows, colors).then((g) => void scene.add(g)));

  const trees = ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_pineDefaultA'];
  const scatterTrees = (count: number, radius: number, clear: number, ok: (x: number, z: number) => boolean = () => true) => {
    const spots = scatter(Math.round(count * density), radius, (x, z) => free(clear, 6)(x, z) && ok(x, z));
    trees.forEach((name, t) => add(`models/nature/${name}.glb`, spots.filter((_, i) => i % trees.length === t).map(([x, z]) => at(x, z, 4.5 + rand() * 2.5))));
  };
  const grassAndFlowers = (radius: number, ok: (x: number, z: number) => boolean = () => true) => {
    const grass = scatter(Math.round(500 * density), radius, (x, z) => distToPath(x, z) > 2 && dry(x, z) && ok(x, z));
    add('models/nature/grass.glb', grass.slice(0, grass.length / 2).map(([x, z]) => at(x, z, 2.5 + rand() * 1.5)), false);
    add('models/nature/grass_large.glb', grass.slice(grass.length / 2).map(([x, z]) => at(x, z, 2.5 + rand() * 1.5)), false);
    const flowers = ['flower_redA', 'flower_yellowA', 'flower_purpleA'];
    const patches = scatter(Math.round(20 * density), radius, (x, z) => free(8, 2.5)(x, z) && ok(x, z));
    flowers.forEach((name, k) => {
      const mats: THREE.Matrix4[] = [];
      patches.forEach(([px, pz], p) => {
        if (p % 3 !== k) return;
        for (let i = 0; i < 8; i++) mats.push(at(px + (rand() - 0.5) * 7, pz + (rand() - 0.5) * 7, 2.2 + rand()));
      });
      add(`models/nature/${name}.glb`, mats, false);
    });
  };
  const houseTypes = ['a', 'c', 'f', 'h', 'k', 'm', 'p', 's'];
  const houses = (plan: { x: number; z: number; yaw: number }[], colors?: THREE.Color[]) => {
    houseTypes.forEach((type, t) => {
      const idx = plan.map((_, i) => i).filter((i) => i % houseTypes.length === t);
      add(
        `models/houses/building-type-${type}.glb`,
        idx.map((i) => at(plan[i].x, plan[i].z, 7, plan[i].yaw, -0.3)),
        q.shadows,
        colors && idx.map((i) => colors[i]),
      );
    });
  };
  const alamoRow = (ax: number, az: number, bx: number, bz: number, gap = 9, side = 5.5) => {
    const mats: THREE.Matrix4[] = [];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (let d = 4; d < len; d += gap) {
      const x = ax + ((bx - ax) * d) / len;
      const z = az + ((bz - az) * d) / len;
      for (const s of [-1, 1]) {
        const k = 3.6 + rand() * 0.8;
        const tx = x + nx * s * side;
        const tz = z + nz * s * side;
        // Nada de álamos en el lugar para encumbrar
        if (dry(tx, tz) && Math.hypot(tx, tz) > 32) mats.push(at(tx, tz, [k, k * 2.4, k]));
      }
    }
    add('models/nature/tree_cone.glb', mats);
  };

  if (map.id === 'parque') {
    // Fondas con ramadas, fogata y banderines, repartidas por el parque
    const fondas = [
      { x: -55, z: -40 },
      { x: 30, z: -45 },
      { x: -50, z: 38 },
      { x: 40, z: 45 },
    ];
    const tents: THREE.Matrix4[] = [];
    for (const f of fondas) {
      tents.push(at(f.x - 7, f.z - 4, 7, 0.3), at(f.x + 7, f.z - 3, 7, -0.2), at(f.x, f.z + 8, 7, Math.PI));
      createGarlands(scene, f);
    }
    add('models/nature/tent_detailedOpen.glb', tents);
    add('models/nature/campfire_stones.glb', fondas.map((f) => at(f.x, f.z, 3)));
    add('models/nature/log.glb', fondas.flatMap((f) => [at(f.x - 3, f.z + 1.5, 3, 0.2), at(f.x + 3, f.z - 1.5, 3, 1.4)]));
    add('models/nature/sign.glb', [at(-18, 18, 3, 0.8), at(18, -18, 3, -0.8)]);
    const nearFonda = (x: number, z: number) => fondas.some((f) => Math.hypot(x - f.x, z - f.z) < 20);
    scatterTrees(170, 330, 70, (x, z) => !nearFonda(x, z));
    alamoRow(-140, -12, 140, -12, 12, 9);
    const pond = map.pond!;
    const shore: THREE.Matrix4[] = [];
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      const r = pond.r + 1 + rand() * 3;
      shore.push(at(pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r, 2 + rand() * 3, undefined, -0.3));
    }
    add('models/nature/rock_smallC.glb', shore);
    grassAndFlowers(160, (x, z) => !nearFonda(x, z));
  } else if (map.id === 'campo') {
    for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) alamoRow(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
    // Potreros con choclos y cerco
    const fences: THREE.Matrix4[] = [];
    const corn: THREE.Matrix4[] = [];
    const fields = [
      { x: 40, z: 45, w: 40, d: 26 },
      { x: -80, z: -60, w: 50, d: 30 },
      { x: 90, z: -70, w: 36, d: 28 },
    ];
    for (const f of fields) {
      const edge = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az);
        const yaw = -Math.atan2(bz - az, bx - ax);
        for (let d = 1.5; d < len; d += 3) fences.push(at(ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len, 3, yaw));
      };
      edge(f.x, f.z, f.x + f.w, f.z);
      edge(f.x + f.w, f.z, f.x + f.w, f.z + f.d);
      edge(f.x + f.w, f.z + f.d, f.x, f.z + f.d);
      edge(f.x, f.z + f.d, f.x, f.z);
      for (let x = f.x + 3; x < f.x + f.w - 2; x += 2.6 / density) for (let z = f.z + 3; z < f.z + f.d - 2; z += 3) corn.push(at(x, z, 1.7 + rand() * 0.3));
    }
    add('models/nature/fence_simple.glb', fences);
    add('models/nature/crops_cornStageD.glb', corn, false);
    const inField = (x: number, z: number) => fields.some((f) => x > f.x - 4 && x < f.x + f.w + 4 && z > f.z - 4 && z < f.z + f.d + 4);
    houses([
      { x: -40, z: 90, yaw: 0.4 },
      { x: 120, z: 60, yaw: 2 },
      { x: -120, z: -20, yaw: 1.2 },
      { x: 60, z: -130, yaw: 3 },
    ]);
    scatterTrees(110, 330, 30, (x, z) => !inField(x, z));
    const bushes = scatter(Math.round(80 * density), 260, (x, z) => free(20, 3)(x, z) && !inField(x, z));
    add('models/nature/plant_bush.glb', bushes.map(([x, z]) => at(x, z, 4 + rand() * 3)));
    grassAndFlowers(170, (x, z) => !inField(x, z));
  } else if (map.id === 'playa') {
    const sea = map.sea!;
    // Rocas en la orilla y quitasoles de colores en la arena
    const rocks: THREE.Matrix4[] = [];
    for (let z = -220; z < 220; z += 9 + rand() * 12) rocks.push(at(sea.x + 6 + rand() * 10, z, 3 + rand() * 4, undefined, -0.4));
    add('models/nature/rock_largeA.glb', rocks.filter((_, i) => i % 2 === 0));
    add('models/nature/rock_largeB.glb', rocks.filter((_, i) => i % 2 === 1));
    createUmbrellas(scene, rand, sea.x + 20, 45, q.shadows);
    add('models/nature/tent_detailedOpen.glb', [at(25, -40, 6, 1.2), at(30, 42, 6, -1.4), at(-10, -70, 6, 0.6)]);
    // Pasto, árboles y casas pasado el médano
    const inland = (x: number) => x > 110;
    houses(Array.from({ length: 9 }, (_, i) => ({ x: 150 + (i % 3) * 18 + rand() * 4, z: -40 + Math.floor(i / 3) * 30 + rand() * 4, yaw: -Math.PI / 2 })));
    scatterTrees(90, 330, 30, (x) => inland(x) && x > 200);
    grassAndFlowers(260, (x) => inland(x));
  } else if (map.id === 'valparaiso') {
    // Casas de colores trepando los cerros
    const palette = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#8ecae6', '#ffb4a2', '#b5e48c', '#cdb4db', '#ffffff'].map((c) => new THREE.Color(c));
    const plan: { x: number; z: number; yaw: number }[] = [];
    const colors: THREE.Color[] = [];
    for (const hill of map.hills.slice(1)) {
      const rings = q.mobile ? 2 : 3;
      for (let ring = 0; ring < rings; ring++) {
        const r = hill.r * (0.35 + ring * 0.3);
        const n = Math.round((r / 9) * density);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ring * 0.4 + rand() * 0.2;
          const x = hill.x + Math.cos(a) * r;
          const z = hill.z + Math.sin(a) * r;
          if (Math.hypot(x, z) < 34 || distToPath(x, z) < 6 || !dry(x, z)) continue;
          // Mirando cerro abajo
          plan.push({ x, z, yaw: -a + Math.PI / 2 });
          colors.push(palette[Math.floor(rand() * palette.length)]);
        }
      }
    }
    houses(plan, colors);
    scatterTrees(60, 300, 30);
    const shoreRocks: THREE.Matrix4[] = [];
    for (let z = -200; z < 200; z += 14 + rand() * 10) shoreRocks.push(at(map.sea!.x + 8 + rand() * 6, z, 3 + rand() * 3, undefined, -0.4));
    add('models/nature/rock_largeB.glb', shoreRocks);
    grassAndFlowers(120);
  }
  await Promise.allSettled(jobs);
}

/** Quitasoles de playa (instanciados): palo blanco y techo de color. */
function createUmbrellas(scene: THREE.Object3D, rand: () => number, x0: number, depth: number, shadows: boolean) {
  const spots: P2[] = [];
  for (let i = 0; i < 26; i++) spots.push([x0 + rand() * depth, -120 + rand() * 240]);
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5);
  poleGeo.translate(0, 1.3, 0);
  const topGeo = new THREE.ConeGeometry(1.5, 0.6, 10, 1, true);
  topGeo.translate(0, 2.6, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#f5f5f5' }), spots.length);
  const tops = new THREE.InstancedMesh(topGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), spots.length);
  const colors = ['#e63946', '#f4a261', '#2a9d8f', '#ffd166', '#118ab2'].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    m.makeTranslation(x, groundHeight(x, z), z);
    poles.setMatrixAt(i, m);
    tops.setMatrixAt(i, m);
    tops.setColorAt(i, colors[i % colors.length]);
  });
  poles.castShadow = tops.castShadow = shadows;
  scene.add(poles, tops);
}
