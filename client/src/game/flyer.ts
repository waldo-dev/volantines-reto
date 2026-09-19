import * as THREE from 'three';
import {
  Rope,
  applyNetKite,
  createKite,
  decodeRope,
  encodeKite,
  encodeRope,
  groundHeight,
  stepKite,
  type BotBrain,
  type KiteDesign,
  type KiteInput,
  type KiteState,
  type LineBody,
  type Loadout,
  type Look,
  type NetState,
  type V3,
} from '@volantines/shared';
import { Character } from '../entities/character';
import { KiteView } from '../entities/kiteView';
import { NameTag } from '../entities/nameTag';
import { ThreadView } from '../entities/threadView';

export const WORLD_RADIUS = 260;

export interface FlyerOptions {
  id: string;
  name: string;
  isBot: boolean;
  look: Look;
  design: KiteDesign;
  loadout: Loadout;
  shadows: boolean;
  ropePoints: number;
  tagColor?: string;
}

/** Alguien que encumbra: el jugador o un bot. Maneja su personaje, su volantín y su hilo. */
export class Flyer {
  readonly id: string;
  readonly isBot: boolean;
  name: string;
  readonly character: Character;
  readonly tag: NameTag;
  readonly pos: V3;
  readonly vel: V3 = { x: 0, y: 0, z: 0 };
  readonly anchor: V3;
  facing = 0;
  loadout: Loadout;
  design: KiteDesign;
  kite: KiteState | null = null;
  view: KiteView | null = null;
  readonly rope: Rope;
  readonly thread: ThreadView;
  /** Último hilo que estuvo gastando el mío (para saber quién me cortó). */
  lastDamager: string | null = null;
  /** Segundos seguidos en el aire (para el logro "Aguante"). */
  flightTime = 0;
  /** En racha "¡Encachado!": el hilo corta más, se recupera más y brilla. */
  boosted = false;
  /** Datos de bot. */
  brain: BotBrain | null = null;
  home: V3;
  botState: 'volar' | 'perseguir' | 'volver' | 'esperar' | 'vengar' = 'esperar';
  /** Bot enojado: a quién va a pegarle. */
  revengeOn: string | null = null;
  /** Charchazos (s de juego): cuándo puede volver a pegar, hasta cuándo está botado y protegido. */
  brawl = { cooldownUntil: 0, stunUntil: 0, guardUntil: 0 };
  /** Empujón de un charchazo: velocidad y hasta cuándo dura. */
  knock = { x: 0, z: 0, until: 0 };
  private tagColor: string | undefined;
  /** Número de volantín (sube con cada encumbre); en red distingue un volantín nuevo de uno cortado. */
  fid = 0;
  botTimer = 1 + Math.random() * 2;
  private threadAccel: V3 = { x: 0, y: -9.8, z: 0 };

  constructor(
    private scene: THREE.Scene,
    opts: FlyerOptions,
    start: V3,
  ) {
    this.id = opts.id;
    this.isBot = opts.isBot;
    this.name = opts.name;
    this.loadout = opts.loadout;
    this.design = opts.design;
    this.pos = { ...start, y: groundHeight(start.x, start.z) };
    this.home = { ...this.pos };
    this.anchor = { x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z };
    this.character = new Character(opts.shadows);
    void this.character.setLook(opts.look);
    scene.add(this.character.group);
    this.tagColor = opts.tagColor;
    this.tag = new NameTag(opts.name, opts.tagColor);
    scene.add(this.tag.sprite);
    this.rope = new Rope(opts.ropePoints);
    this.thread = new ThreadView(this.rope, this.loadout.line.color);
    this.thread.line.visible = false;
    scene.add(this.thread.line);
  }

  /** Volando de verdad: ni guardado ni cortado. */
  get flying() {
    return !!this.kite && !this.kite.broken && !this.kite.stowed;
  }

  get altitude() {
    return this.kite ? this.kite.pos.y - groundHeight(this.kite.pos.x, this.kite.pos.z) : 0;
  }

  setLook(look: Look) {
    void this.character.setLook(look);
  }

  setLoadout(lo: Loadout) {
    this.loadout = lo;
    this.thread.setColor(lo.line.color);
    if (this.view) this.view.setKite(lo.kite, this.design);
  }

  setDesign(d: KiteDesign) {
    this.design = d;
    if (this.view) this.view.setKite(this.loadout.kite, d);
  }

  setName(name: string, color?: string) {
    this.name = name;
    if (color) this.tagColor = color;
    this.tagText = name;
    this.tag.set(name, this.tagColor);
  }

  /** Letrero con un ícono delante del nombre (💫 botado, 🔊 hablando) o solo el nombre. */
  setTagIcon(icon: string | null) {
    const text = icon ? `${icon} ${this.name}` : this.name;
    if (text === this.tagText) return;
    this.tagText = text;
    this.tag.set(text, this.tagColor);
  }

  private tagText = '';

  /** Saca un volantín nuevo (o el guardado) y lo encumbra a favor del viento. */
  launch(windX: number, windZ: number) {
    const len = Math.hypot(windX, windZ) || 1;
    this.view?.dispose();
    this.character.handPosition(this.anchor);
    this.kite = createKite(this.anchor, windX / len, windZ / len, Math.random() * 100);
    this.view = new KiteView(this.loadout.kite, this.design, this.scene, true);
    this.view.resetTail(this.kite.pos);
    this.rope.reset(this.anchor, this.kite.pos);
    this.thread.line.visible = true;
    this.lastDamager = null;
    this.flightTime = 0;
    this.fid++;
  }

  /** Estado para mandar al servidor (modo online). */
  netState(): NetState {
    const s: NetState = {
      p: [Math.round(this.pos.x * 100) / 100, Math.round(this.pos.y * 100) / 100, Math.round(this.pos.z * 100) / 100],
      v: [Math.round(this.vel.x * 100) / 100, Math.round(this.vel.z * 100) / 100],
      f: Math.round(this.facing * 100) / 100,
      fid: this.fid,
    };
    if (this.kite && !this.kite.broken) {
      s.k = encodeKite(this.kite);
      if (!this.kite.stowed) s.rope = encodeRope(this.rope.pts);
    }
    return s;
  }

  /** Aplica el estado (interpolado) de otro jugador que llega por red. */
  applyNet(s: NetState) {
    this.pos.x = s.p[0];
    this.pos.y = s.p[1];
    this.pos.z = s.p[2];
    this.vel.x = s.v[0];
    this.vel.z = s.v[1];
    this.facing = s.f;
    if (s.k) {
      if (!this.kite || s.fid !== this.fid) {
        this.view?.dispose();
        this.kite = createKite(this.anchor, 1, 0);
        this.view = new KiteView(this.loadout.kite, this.design, this.scene, true);
        this.fid = s.fid;
        applyNetKite(this.kite, s.k);
        this.view.resetTail(this.kite.pos);
      }
      applyNetKite(this.kite, s.k);
      if (s.rope) decodeRope(s.rope, this.rope.pts);
    } else if (this.kite) {
      this.view?.dispose();
      this.view = null;
      this.kite = null;
    }
  }

  dispose() {
    this.view?.dispose();
    this.scene.remove(this.character.group, this.tag.sprite, this.thread.line);
  }

  /** Suelta el volantín cortado para que caiga solo; el personaje queda libre. */
  detachKite(): { kite: KiteState; view: KiteView } | null {
    if (!this.kite || !this.view) return null;
    const out = { kite: this.kite, view: this.view };
    this.kite = null;
    this.view = null;
    this.thread.line.visible = false;
    this.flightTime = 0;
    return out;
  }

  /** Paso fijo de física: mueve al personaje (velocidad en mundo) y al volantín. */
  step(dt: number, input: KiteInput, moveX: number, moveZ: number, wind: V3) {
    this.vel.x = moveX;
    this.vel.z = moveZ;
    this.pos.x += moveX * dt;
    this.pos.z += moveZ * dt;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD_RADIUS) {
      this.pos.x *= WORLD_RADIUS / r;
      this.pos.z *= WORLD_RADIUS / r;
    }
    const y = groundHeight(this.pos.x, this.pos.z);
    this.vel.y = (y - this.pos.y) / dt;
    this.pos.y = y;
    if (Math.hypot(moveX, moveZ) > 0.2) this.facing = Math.atan2(moveX, moveZ);

    const k = this.kite;
    if (!k) return;
    stepKite(k, this.loadout, input, this.anchor, this.vel, wind, dt);
    if (k.stowed) return;
    // Hilo: un poco más largo que la distancia real para que cuelgue cuando está flojo
    const sag = 1.004 + 0.03 * (1 - k.tension);
    this.threadAccel.x = wind.x * 0.15;
    this.threadAccel.z = wind.z * 0.15;
    this.rope.step(this.anchor, k.broken ? null : k.pos, k.lineLength * sag, this.threadAccel, 0.02, dt, 8);
  }

  /** Actualización visual por cuadro. */
  render(dt: number, time: number, wind: V3) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.character.update(this.pos, speed, this.flying ? this.kite!.pos : null, this.facing, dt);
    this.character.handPosition(this.anchor);
    const k = this.kite;
    const visible = !!k && !k.stowed;
    if (this.view) {
      this.view.setVisible(visible);
      if (visible) this.view.update(k!, this.anchor, wind, time, dt);
    }
    this.thread.line.visible = visible;
    if (visible) this.thread.update();
    this.thread.setGlow(visible && this.boosted, time);
    this.tag.sprite.position.set(this.pos.x, this.pos.y + 2.25, this.pos.z);
  }

  lineBody(): LineBody | null {
    if (!this.flying) return null;
    return { id: this.id, pts: this.rope.pts, kite: this.kite!, lo: this.loadout, boost: this.boosted };
  }

  /** Dirección horizontal del viento que usan los bots para ubicarse. */
  static windDir(wind: V3): V3 {
    const l = Math.hypot(wind.x, wind.z) || 1;
    return { x: wind.x / l, y: 0, z: wind.z / l };
  }
}
