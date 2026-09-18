import * as THREE from 'three';
import { Rope, type KiteDef, type KiteState, type V3 } from '@volantines/shared';
import { designTexture, type KiteDesign } from '../kiteDesigns';
import { KITE_SHAPES, shapeArea, shapeBottom, type KiteShape } from '../kiteShapes';

/** Se exagera el tamaño visible para que el volantín se lea bien a 50+ m. */
const VISUAL_SCALE = 1.8;
const TAIL_WIDTH = 0.09;
const LONG_TAIL_WIDTH = 0.14;

/**
 * Papel del volantín: abanico desde el centro con UV sobre el cuadrado [-1, 1]²,
 * así la imagen se ve derecha (en el rombo, las puntas caen en el centro de cada borde).
 */
function shapeGeometry(shape: KiteShape, scale: number) {
  const pos = [0, 0, 0];
  const uv = [0.5, 0.5];
  const normal = [0, 0, 1];
  for (const [x, y] of shape.pts) {
    pos.push(x * scale, y * scale, 0);
    uv.push((x + 1) / 2, (y + 1) / 2);
    normal.push(0, 0, 1);
  }
  const idx: number[] = [];
  const n = shape.pts.length;
  for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setIndex(idx);
  return geo;
}

/** Varilla recta entre dos puntos del plano del volantín. */
function stick(ax: number, ay: number, bx: number, by: number, mat: THREE.Material) {
  const len = Math.hypot(bx - ax, by - ay);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, len, 0.03), mat);
  m.position.set((ax + bx) / 2, (ay + by) / 2, -0.02);
  m.rotation.z = Math.atan2(-(bx - ax), by - ay);
  return m;
}

export class KiteView {
  readonly group = new THREE.Group();
  private inner = new THREE.Group();
  private tail = new Rope(10);
  private tailMesh: THREE.Mesh;
  private tailPos: Float32Array;
  private bottom = new THREE.Object3D();
  private tmp = new THREE.Vector3();
  private tailStart: V3 = { x: 0, y: 0, z: 0 };
  private tailAccel: V3 = { x: 0, y: 0, z: 0 };
  private diagonal = 1;
  private tailLength = 2;
  private tailWidth = TAIL_WIDTH;
  private texture: THREE.Texture | null = null;

  constructor(
    def: KiteDef,
    design: KiteDesign,
    private scene: THREE.Scene,
    private shadows: boolean,
  ) {
    this.group.add(this.inner);
    scene.add(this.group);

    // Cola: cinta de papel (dos vértices por punto de la cuerda)
    this.tailPos = new Float32Array(this.tail.n * 2 * 3);
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.BufferAttribute(this.tailPos, 3));
    const idx: number[] = [];
    for (let i = 0; i < this.tail.n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    tailGeo.setIndex(idx);
    this.tailMesh = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: design.tail, side: THREE.DoubleSide }));
    this.tailMesh.frustumCulled = false;
    scene.add(this.tailMesh);

    this.setKite(def, design);
  }

  setKite(def: KiteDef, design: KiteDesign) {
    this.inner.clear();
    this.texture?.dispose();
    // Cada tipo tiene su forma; se escala para que el papel tenga el área del volantín
    const shape = KITE_SHAPES[def.tipo] ?? KITE_SHAPES.comision;
    const scale = Math.sqrt(def.area / shapeArea(shape)) * VISUAL_SCALE;
    const D = 2 * scale;
    this.diagonal = D;
    // Con cola larga (cambucha, chonchón) la cola es parte del volantín; los demás llevan solo un fleco
    this.tailLength = def.cola ? D * 3.2 : D * 0.9;
    this.tailWidth = def.cola ? LONG_TAIL_WIDTH : TAIL_WIDTH;
    this.texture = designTexture(design);
    // Algo de emisión para que el papel se vea "a contraluz" desde el suelo
    const paper = new THREE.Mesh(
      shapeGeometry(shape, scale),
      new THREE.MeshLambertMaterial({
        map: this.texture,
        emissiveMap: this.texture,
        emissive: '#ffffff',
        emissiveIntensity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    paper.castShadow = this.shadows;
    const stickMat = new THREE.MeshLambertMaterial({ color: '#8a6a3c' });
    this.inner.add(paper);
    const top = Math.max(...shape.pts.map((p) => p[1])) * scale;
    const bottom = shapeBottom(shape) * scale;
    if (shape.sticks === 'cross') {
      this.inner.add(stick(0, top, 0, bottom, stickMat));
      // La varilla horizontal (colihue) va arqueada hacia atrás
      const w = Math.max(...shape.pts.map((p) => p[0])) * scale;
      const y = shape.bowY * scale;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-w, y + 0.02 * D, -0.02),
        new THREE.Vector3(0, y + 0.1 * D, -0.18 * D),
        new THREE.Vector3(w, y + 0.02 * D, -0.02),
      );
      this.inner.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.015, 4), stickMat));
    } else if (shape.sticks === 'star') {
      // Chonchón: tres varillas que unen puntas opuestas del hexágono
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = shape.pts[i];
        const [bx, by] = shape.pts[i + 3];
        this.inner.add(stick(ax * scale, ay * scale, bx * scale, by * scale, stickMat));
      }
    }
    this.bottom.position.set(0, bottom, 0);
    this.inner.add(this.bottom);
    (this.tailMesh.material as THREE.MeshBasicMaterial).color.set(design.tail);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
    this.tailMesh.visible = v;
  }

  resetTail(pos: V3) {
    this.tail.reset(pos, { x: pos.x, y: pos.y - 2, z: pos.z });
  }

  update(k: KiteState, anchor: V3, wind: V3, time: number, dt: number) {
    this.group.position.set(k.pos.x, k.pos.y, k.pos.z);
    // Crece un poco con la distancia para que siga legible cuando está alto
    const far = Math.hypot(k.pos.x - anchor.x, k.pos.y - anchor.y, k.pos.z - anchor.z);
    this.group.scale.setScalar(1 + Math.min(1.2, far / 60));
    this.group.up.set(0, 1, 0);
    this.group.lookAt(anchor.x, anchor.y, anchor.z);
    // La punta del volantín: 0 = arriba; el giro es el mismo que usa la física
    this.group.rotateZ(-k.heading);
    if (!k.broken) {
      this.group.rotateX(-0.25 - 0.25 * k.aoa + Math.sin(time * 5.3) * 0.03);
      this.inner.rotation.z = Math.sin(time * 3.1) * 0.04 * (1 - k.tension);
    }

    // Cola: cuelga del vértice inferior y flamea con el viento
    this.bottom.getWorldPosition(this.tmp);
    this.tailStart.x = this.tmp.x;
    this.tailStart.y = this.tmp.y;
    this.tailStart.z = this.tmp.z;
    this.tailAccel.x = wind.x * 3;
    this.tailAccel.y = -9.8;
    this.tailAccel.z = wind.z * 3;
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      // Cortada, la cola queda en un muñón
      const len = k.tailCut ? this.diagonal * 0.2 : this.tailLength;
      this.tail.step(this.tailStart, null, len, this.tailAccel, 0.08, Math.min(dt, 1 / 30) / steps, 4);
    }
    const pts = this.tail.pts;
    const w = this.tailWidth * this.group.scale.x;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, pts.length - 1)];
      const o = pts[Math.max(i - 1, 0)];
      // Ancho perpendicular al tramo, en horizontal
      let px = -(q.z - o.z);
      let pz = q.x - o.x;
      const len = Math.hypot(px, pz) || 1;
      const flutter = Math.sin(time * 9 + i * 0.8) * 0.5;
      px = (px / len) * w;
      pz = (pz / len) * w;
      const j = i * 6;
      this.tailPos[j] = p.x + px;
      this.tailPos[j + 1] = p.y + flutter * w;
      this.tailPos[j + 2] = p.z + pz;
      this.tailPos[j + 3] = p.x - px;
      this.tailPos[j + 4] = p.y - flutter * w;
      this.tailPos[j + 5] = p.z - pz;
    }
    this.tailMesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group, this.tailMesh);
  }
}
