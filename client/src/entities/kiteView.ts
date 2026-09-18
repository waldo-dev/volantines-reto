import * as THREE from 'three';
import { Rope, type KiteDef, type KiteState, type V3 } from '@volantines/shared';
import { designTexture, type KiteDesign } from '../kiteDesigns';

/** Se exagera el tamaño visible para que el volantín se lea bien a 50+ m. */
const VISUAL_SCALE = 1.8;
const TAIL_WIDTH = 0.09;

/** Rombo con UV de modo que la imagen se vea derecha: puntas en el centro de cada borde del cuadrado. */
function diamondGeometry(D: number) {
  const h = D / 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, h, 0, h, 0, 0, 0, -h, 0, -h, 0, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 1, 1, 0.5, 0.5, 0, 0, 0.5], 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setIndex([0, 3, 1, 1, 3, 2]);
  return geo;
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
    // Rombo de diagonales iguales: área = D² / 2
    const D = Math.sqrt(def.area * 2) * VISUAL_SCALE;
    this.diagonal = D;
    this.texture = designTexture(design);
    // Algo de emisión para que el papel se vea "a contraluz" desde el suelo
    const paper = new THREE.Mesh(
      diamondGeometry(D),
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
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.03, D, 0.03), stickMat);
    vertical.position.z = -0.02;
    // La varilla horizontal (colihue) va arqueada hacia atrás
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-D / 2, 0.02 * D, -0.02),
      new THREE.Vector3(0, 0.1 * D, -0.18 * D),
      new THREE.Vector3(D / 2, 0.02 * D, -0.02),
    );
    const bow = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.015, 4), stickMat);
    this.bottom.position.set(0, -D / 2, 0);
    this.inner.add(paper, vertical, bow, this.bottom);
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
      this.tail.step(this.tailStart, null, this.diagonal * 2.2, this.tailAccel, 0.08, Math.min(dt, 1 / 30) / steps, 4);
    }
    const pts = this.tail.pts;
    const w = TAIL_WIDTH * this.group.scale.x;
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
