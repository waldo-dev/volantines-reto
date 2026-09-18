import * as THREE from 'three';
import { groundHeight, stepKite, type KiteDesign, type KiteState, type Loadout, type V3 } from '@volantines/shared';
import type { KiteView } from '../entities/kiteView';
import type { Flyer } from './flyer';

/** A qué distancia (horizontal) se alcanza a recoger un volantín caído. */
export const CAPTURE_RADIUS = 2.4;
/** Segundos que un volantín queda en el suelo antes de que se lo lleve alguien más (desaparece). */
const LIFETIME_ON_GROUND = 90;

export interface FallenKite {
  kite: KiteState;
  view: KiteView;
  design: KiteDesign;
  lo: Loadout;
  owner: string;
  ownerName: string;
  groundTime: number;
  beam: THREE.Mesh;
}

const NO_INPUT = { tirar: false, soltar: false, dirX: 0 };
const beamGeo = new THREE.CylinderGeometry(0.12, 0.35, 40, 8, 1, true);
beamGeo.translate(0, 20, 0);

/** Volantines cortados: caen con el viento y quedan en el suelo hasta que alguien los captura. */
export class FallenKites {
  readonly list: FallenKite[] = [];

  constructor(private scene: THREE.Scene) {}

  add(from: Flyer, detached: { kite: KiteState; view: KiteView }) {
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.renderOrder = 5;
    this.scene.add(beam);
    this.list.push({
      kite: detached.kite,
      view: detached.view,
      design: from.design,
      lo: from.loadout,
      owner: from.id,
      ownerName: from.name,
      groundTime: 0,
      beam,
    });
  }

  step(dt: number, windAt: (alt: number) => V3) {
    for (const f of this.list) {
      const k = f.kite;
      const alt = k.pos.y - groundHeight(k.pos.x, k.pos.z);
      stepKite(k, f.lo, NO_INPUT, k.pos, k.vel, windAt(alt), dt);
      if (k.grounded) f.groundTime += dt;
    }
    for (const f of [...this.list]) if (f.groundTime > LIFETIME_ON_GROUND) this.remove(f);
  }

  render(dt: number, time: number, windAt: (alt: number) => V3) {
    for (const f of this.list) {
      const k = f.kite;
      f.view.update(k, { x: k.pos.x - 1, y: k.pos.y - 3, z: k.pos.z }, windAt(0), time, dt);
      f.beam.position.set(k.pos.x, groundHeight(k.pos.x, k.pos.z), k.pos.z);
      (f.beam.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(time * 4);
    }
  }

  /** Quien esté más cerca de un volantín caído (y a menos de CAPTURE_RADIUS) se lo queda. */
  captures(flyers: Flyer[]): { fallen: FallenKite; by: Flyer }[] {
    const out: { fallen: FallenKite; by: Flyer }[] = [];
    for (const f of this.list) {
      const k = f.kite;
      if (k.pos.y - groundHeight(k.pos.x, k.pos.z) > 2.5) continue;
      let best: Flyer | null = null;
      let bestD = CAPTURE_RADIUS;
      for (const fl of flyers) {
        const d = Math.hypot(fl.pos.x - k.pos.x, fl.pos.z - k.pos.z);
        if (d < bestD) {
          bestD = d;
          best = fl;
        }
      }
      if (best) out.push({ fallen: f, by: best });
    }
    for (const c of out) this.remove(c.fallen);
    return out;
  }

  nearest(p: V3): { fallen: FallenKite; dist: number } | null {
    let best: FallenKite | null = null;
    let bestD = Infinity;
    for (const f of this.list) {
      const d = Math.hypot(f.kite.pos.x - p.x, f.kite.pos.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best ? { fallen: best, dist: bestD } : null;
  }

  remove(f: FallenKite) {
    const i = this.list.indexOf(f);
    if (i >= 0) this.list.splice(i, 1);
    f.view.dispose();
    this.scene.remove(f.beam);
    (f.beam.material as THREE.Material).dispose();
  }
}
