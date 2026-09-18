import * as THREE from 'three';
import { POND, groundHeight, type V3 } from '@volantines/shared';
import { instanced, loadTexture } from '../assets';

const SKY_TOP = new THREE.Color('#3f86d4');
const SKY_HORIZON = new THREE.Color('#cfe5f5');

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
/** Senderos de tierra: del cerro a la fonda, a la laguna y al pueblo. */
const PATHS: P2[][] = [
  [[0, 0], [-18, 16], [-40, 34], [-62, 44]],
  [[0, 0], [22, -18], [50, -40], [72, -58]],
  [[-40, 34], [-22, 70], [10, 100], [55, 118], [100, 126]],
];
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

const inPond = (x: number, z: number, margin = 0) => Math.hypot(x - POND.x, z - POND.z) < POND.r + margin;

export interface WorldQuality {
  shadows: boolean;
  mobile: boolean;
}

export interface World {
  sun: THREE.DirectionalLight;
  update(dt: number, wind: V3 & { angle: number; speed: number }, focus: V3, time: number): void;
}

export function createWorld(scene: THREE.Scene, q: WorldQuality): World {
  const rand = mulberry32(18_09);
  const density = q.mobile ? 0.55 : 1;

  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON, 200, 1150);

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
  scene.add(sky);

  // Luces
  scene.add(new THREE.HemisphereLight('#d8ecff', '#5d7b3a', 1.1));
  const sun = new THREE.DirectionalLight('#fff4de', 2.2);
  sun.position.set(-60, 120, 40);
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
  scene.add(sun, sun.target);

  createTerrain(scene, q);
  createWater(scene);
  createAndes(scene, rand);
  const clouds = createClouds(scene, rand);

  // Banderas chilenas: una en el cerro y dos en la fonda. Muestran hacia dónde sopla el viento.
  const flags = [
    createFlag(6, -14, 6),
    createFlag(FONDA.x - 10, FONDA.z - 8, 7),
    createFlag(FONDA.x + 12, FONDA.z + 6, 7),
  ];
  for (const f of flags) scene.add(f.group);
  createGarlands(scene);

  void populate(scene, q, rand, density);

  return {
    sun,
    update(dt, wind, focus, time) {
      // La luz del sol sigue al jugador para que las sombras cercanas se vean nítidas
      sun.position.set(focus.x - 60, focus.y + 120, focus.z + 40);
      sun.target.position.set(focus.x, focus.y, focus.z);
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
function createTerrain(scene: THREE.Scene, q: WorldQuality) {
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
      colors[i * 3] = 0.9 + 0.18 * n + dry + shore;
      colors[i * 3 + 1] = 0.95 + 0.1 * n + dry * 0.6 + shore * 0.5;
      colors[i * 3 + 2] = 0.85 + 0.05 * n + shore * 0.2;
      const d = distToPath(x, z);
      mask[i] = hole === 0 ? 1 - THREE.MathUtils.smoothstep(d, 1.2, 3.2) : 0;
      if (inPond(x, z, 3)) mask[i] = Math.max(mask[i], 0.7); // orilla de tierra
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

function createWater(scene: THREE.Scene) {
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r + 2, 40),
    new THREE.MeshPhongMaterial({ color: '#4d97c9', shininess: 90, specular: '#cfe8ff', transparent: true, opacity: 0.88 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND.x, POND.level, POND.z);
  scene.add(water);
}

function createAndes(scene: THREE.Scene, rand: () => number) {
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

function createClouds(scene: THREE.Scene, rand: () => number) {
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

/** Guirnaldas de banderines tricolor sobre la fonda, en triángulos instanciados. */
function createGarlands(scene: THREE.Scene) {
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

async function populate(scene: THREE.Scene, q: WorldQuality, rand: () => number, density: number) {
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
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = POND.r + 1 + rand() * 3;
    shore.push(at(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, 2 + rand() * 3, undefined, -0.3));
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
