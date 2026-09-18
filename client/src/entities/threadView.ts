import * as THREE from 'three';
import type { Rope } from '@volantines/shared';

/** Dibuja el hilo a partir de los puntos de la cuerda Verlet. */
export class ThreadView {
  readonly line: THREE.Line;
  private positions: Float32Array;

  constructor(
    private rope: Rope,
    color: string,
  ) {
    this.positions = new Float32Array(rope.n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false;
  }

  setColor(color: string) {
    (this.line.material as THREE.LineBasicMaterial).color.set(color);
  }

  update() {
    const pts = this.rope.pts;
    for (let i = 0; i < pts.length; i++) {
      this.positions[i * 3] = pts[i].x;
      this.positions[i * 3 + 1] = pts[i].y;
      this.positions[i * 3 + 2] = pts[i].z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}
