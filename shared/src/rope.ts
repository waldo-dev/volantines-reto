import type { V3 } from './vec';

/** Cuerda Verlet: se usa para dibujar el hilo y la cola, y luego para detectar cruces. */
export class Rope {
  readonly pts: V3[];
  private readonly prev: V3[];

  constructor(readonly n: number) {
    this.pts = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
    this.prev = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  }

  reset(a: V3, b: V3): void {
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      const p = this.pts[i];
      p.x = a.x + (b.x - a.x) * t;
      p.y = a.y + (b.y - a.y) * t;
      p.z = a.z + (b.z - a.z) * t;
      this.prev[i].x = p.x;
      this.prev[i].y = p.y;
      this.prev[i].z = p.z;
    }
  }

  /** `end` null deja el extremo libre (hilo cortado, cola). `accel` suma gravedad y empuje del viento. */
  step(start: V3, end: V3 | null, length: number, accel: V3, damping: number, dt: number, iterations = 10): void {
    const { pts, prev, n } = this;
    const rest = length / (n - 1);
    const last = end ? n - 1 : n;
    const dt2 = dt * dt;
    const keep = 1 - damping;
    for (let i = 1; i < last; i++) {
      const p = pts[i];
      const q = prev[i];
      const vx = (p.x - q.x) * keep;
      const vy = (p.y - q.y) * keep;
      const vz = (p.z - q.z) * keep;
      q.x = p.x;
      q.y = p.y;
      q.z = p.z;
      p.x += vx + accel.x * dt2;
      p.y += vy + accel.y * dt2;
      p.z += vz + accel.z * dt2;
    }
    for (let it = 0; it < iterations; it++) {
      pin(pts[0], start);
      if (end) pin(pts[n - 1], end);
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= rest || d < 1e-6) continue; // solo se estira, no se comprime
        const aFixed = i === 0;
        const bFixed = end !== null && i + 1 === n - 1;
        const diff = (d - rest) / d;
        const wa = aFixed ? 0 : bFixed ? 1 : 0.5;
        const wb = bFixed ? 0 : aFixed ? 1 : 0.5;
        a.x += dx * diff * wa;
        a.y += dy * diff * wa;
        a.z += dz * diff * wa;
        b.x -= dx * diff * wb;
        b.y -= dy * diff * wb;
        b.z -= dz * diff * wb;
      }
    }
    pin(pts[0], start);
    if (end) pin(pts[n - 1], end);
  }
}

function pin(p: V3, to: V3) {
  p.x = to.x;
  p.y = to.y;
  p.z = to.z;
}
