import * as THREE from 'three';
import type { V3 } from '@volantines/shared';

const MAX = 120;

/** Chispas donde se cruzan los hilos: partículas simples con gravedad. */
export class Sparks {
  private positions = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private next = 0;
  private points: THREE.Points;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: '#ffe27a', size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX; i++) this.positions[i * 3 + 1] = -1000;
  }

  burst(p: V3, count = 4) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.positions.set([p.x, p.y, p.z], i * 3);
      this.vel.set([(Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6], i * 3);
      this.life[i] = 0.4 + Math.random() * 0.3;
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= 9.8 * dt;
      this.positions[j] += this.vel[j] * dt;
      this.positions[j + 1] = this.life[i] > 0 ? this.positions[j + 1] + this.vel[j + 1] * dt : -1000;
      this.positions[j + 2] += this.vel[j + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
