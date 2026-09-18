import * as THREE from 'three';
import type { Rope } from '@volantines/shared';

/** Dibuja el hilo a partir de los puntos de la cuerda Verlet. */
export class ThreadView {
  readonly line: THREE.Line;
  private positions: Float32Array;
  private color: string;
  private glowing = false;

  constructor(
    private rope: Rope,
    color: string,
  ) {
    this.color = color;
    this.positions = new Float32Array(rope.n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false;
  }

  setColor(color: string) {
    this.color = color;
    if (!this.glowing) (this.line.material as THREE.LineBasicMaterial).color.set(color);
  }

  /** En racha el hilo brilla naranjo y titila. */
  setGlow(on: boolean, time: number) {
    const m = this.line.material as THREE.LineBasicMaterial;
    if (on) m.color.setHSL(0.08 + 0.03 * Math.sin(time * 14), 1, 0.6);
    else if (this.glowing) m.color.set(this.color);
    this.glowing = on;
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
