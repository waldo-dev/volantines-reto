import * as THREE from 'three';
import {
  canReach,
  createKite,
  groundHeight,
  stepKite,
  type CarryItem,
  type KiteDef,
  type KiteDesign,
  type KiteState,
  type Loadout,
  type NetFallen,
  type PoleDef,
  type V3,
} from '@volantines/shared';
import { KiteView } from '../entities/kiteView';
import type { Flyer } from './flyer';

/** Segundos que un volantín queda en el suelo antes de que se lo lleve alguien más (desaparece). */
const LIFETIME_ON_GROUND = 90;

export interface FallenKite {
  id: string;
  /** En modo online la posición la manda el servidor (no se simula aquí). */
  remote: boolean;
  target: V3 | null;
  kite: KiteState;
  view: KiteView;
  design: KiteDesign;
  lo: Loadout;
  owner: string;
  ownerName: string;
  groundTime: number;
  beam: THREE.Mesh;
  /** Se le cayó de la mochila a este jugador: no lo puede recoger hasta `lockUntil` (s de juego). */
  lockBy?: string;
  lockUntil?: number;
}

const NO_INPUT = { tirar: false, soltar: false, dirX: 0 };
const beamGeo = new THREE.CylinderGeometry(0.12, 0.35, 40, 8, 1, true);
beamGeo.translate(0, 20, 0);

/** Volantines cortados: caen con el viento y quedan en el suelo hasta que alguien los captura. */
export class FallenKites {
  readonly list: FallenKite[] = [];

  private nextId = 1;

  constructor(private scene: THREE.Scene) {}

  private beam() {
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.renderOrder = 5;
    this.scene.add(beam);
    return beam;
  }

  /** Volantín caído que avisa el servidor (modo online). */
  addNet(msg: { id: string; owner: string; ownerName: string; design: KiteDesign; p: [number, number, number]; h: number }, def: KiteDef, lo: Loadout) {
    const kite = createKite({ x: msg.p[0], y: msg.p[1], z: msg.p[2] }, 1, 0);
    kite.pos = { x: msg.p[0], y: msg.p[1], z: msg.p[2] };
    kite.heading = msg.h;
    kite.broken = true;
    const view = new KiteView(def, msg.design, this.scene, true);
    view.resetTail(kite.pos);
    this.list.push({ id: msg.id, remote: true, target: { ...kite.pos }, kite, view, design: msg.design, lo, owner: msg.owner, ownerName: msg.ownerName, groundTime: 0, beam: this.beam() });
  }

  /** Posiciones que manda el servidor en cada snapshot. */
  syncNet(list: NetFallen[]) {
    for (const n of list) {
      const f = this.list.find((x) => x.id === n.id);
      if (!f) continue;
      f.target = { x: n.p[0], y: n.p[1], z: n.p[2] };
      f.kite.heading = n.h;
      f.kite.grounded = n.g === 1;
    }
  }

  removeById(id: string) {
    const f = this.list.find((x) => x.id === id);
    if (f) this.remove(f);
    return f ?? null;
  }

  clear() {
    for (const f of [...this.list]) this.remove(f);
  }

  /** Un volantín que se cayó de la mochila de `by`: queda en el suelo junto a `p` para que lo recoja otro. */
  addDropped(item: CarryItem, def: KiteDef, lo: Loadout, p: V3, by: string, lockUntil: number) {
    const pos = { x: p.x + 0.8, y: groundHeight(p.x + 0.8, p.z) + 0.3, z: p.z };
    const kite = createKite(pos, 1, 0);
    kite.pos = { ...pos };
    kite.broken = true;
    const view = new KiteView(def, item.design, this.scene, true);
    view.resetTail(kite.pos);
    this.list.push({
      id: `local-${this.nextId++}`,
      remote: false,
      target: null,
      kite,
      view,
      design: item.design,
      lo,
      owner: item.owner,
      ownerName: item.ownerName,
      groundTime: 0,
      beam: this.beam(),
      lockBy: by,
      lockUntil,
    });
  }

  add(from: Flyer, detached: { kite: KiteState; view: KiteView }) {
    const beam = this.beam();
    this.list.push({
      id: `local-${this.nextId++}`,
      remote: false,
      target: null,
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
      if (f.remote) {
        // Se acerca suave a la posición que mandó el servidor
        if (f.target) {
          const a = Math.min(1, dt * 8);
          k.pos.x += (f.target.x - k.pos.x) * a;
          k.pos.y += (f.target.y - k.pos.y) * a;
          k.pos.z += (f.target.z - k.pos.z) * a;
        }
        continue;
      }
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

  /**
   * Quien esté más cerca de un volantín caído y lo alcance se lo queda. `poleOf` dice con qué colihue
   * recoge cada uno, o null si no puede recoger (mochila llena).
   */
  captures(flyers: Flyer[], poleOf: (f: Flyer) => PoleDef | null, now = 0): { fallen: FallenKite; by: Flyer }[] {
    const out: { fallen: FallenKite; by: Flyer }[] = [];
    const taken = new Map<Flyer, number>();
    for (const f of this.list) {
      const k = f.kite;
      const height = k.pos.y - groundHeight(k.pos.x, k.pos.z);
      let best: Flyer | null = null;
      let bestD = Infinity;
      for (const fl of flyers) {
        if (taken.has(fl)) continue; // uno por paso: así se respeta la capacidad de la mochila
        if (f.lockBy === fl.id && now < (f.lockUntil ?? 0)) continue;
        const pole = poleOf(fl);
        const d = Math.hypot(fl.pos.x - k.pos.x, fl.pos.z - k.pos.z);
        if (pole && d < bestD && canReach(pole, d, height)) {
          bestD = d;
          best = fl;
        }
      }
      if (best) {
        out.push({ fallen: f, by: best });
        taken.set(best, 1);
      }
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
