import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { V3 } from '@volantines/shared';
import { loadGLB, toLambert } from '../assets';
import type { HatId, Look } from '../profile';

/** Los personajes de Kenney miden ~0,67 unidades; se escalan a ~1,6 m. */
const SCALE = 2.4;
/** Alto de la cabeza sobre el hueso "head" (en unidades del modelo). */
const HEAD_TOP = 0.33;
/** Dónde van los lentes respecto del hueso de la cabeza: a la altura de los ojos, delante de la cara. */
const GLASSES_OFFSET = new THREE.Vector3(0, 0.1, 0.085);
// En la pose de reposo los brazos de Kenney van horizontales: el derecho hacia -X y el izquierdo hacia +X
const RIGHT_ARM_AXIS = new THREE.Vector3(-1, 0, 0);
const LEFT_ARM_AXIS = new THREE.Vector3(1, 0, 0);
/** Largo del brazo hasta la mano, en unidades del modelo. */
const ARM_LEN = 0.25;

type Anim = 'idle' | 'walk' | 'sprint' | 'pick-up' | 'emote-yes' | 'holding-both' | 'attack-melee-right' | 'die';

/** Gorros hechos con formas simples, en el espacio del hueso de la cabeza. */
function buildHat(id: HatId, color: string): THREE.Object3D | null {
  if (id === 'none') return null;
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  if (id === 'jockey') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.scale.set(1, 0.55, 0.85);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.2), mat);
    visor.position.set(0, 0.005, 0.2);
    visor.rotation.x = -0.12;
    g.add(cap, visor);
    g.position.y = HEAD_TOP - 0.06;
  } else if (id === 'chupalla') {
    // Sombrero de paja de huaso, con cinta de color
    const straw = new THREE.MeshLambertMaterial({ color: '#e3c77c' });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 20), straw);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.15, 16), straw);
    crown.position.y = 0.08;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.04, 16), mat);
    band.position.y = 0.03;
    g.add(brim, crown, band);
    g.position.y = HEAD_TOP - 0.07;
  } else {
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.245, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    beanie.scale.set(1, 0.75, 0.9);
    const fold = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 16), mat);
    fold.scale.z = 0.9;
    const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    pompom.position.y = 0.19;
    g.add(beanie, fold, pompom);
    g.position.y = HEAD_TOP - 0.07;
  }
  return g;
}

export class Character {
  readonly group = new THREE.Group();
  private root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<Anim, THREE.AnimationAction>();
  private current: Anim | null = null;
  /** La última animación que sonó (aunque `current` se haya borrado para poder repetirla): de ella se hace el fundido. */
  private last: THREE.AnimationAction | null = null;
  private oneShot = false;
  private armR: THREE.Bone | null = null;
  private armL: THREE.Bone | null = null;
  private head: THREE.Bone | null = null;
  private accessories: THREE.Object3D[] = [];
  private reel: THREE.Mesh;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private loadToken = 0;
  /** Mano de reserva mientras carga el modelo. */
  private fallbackHand = new THREE.Object3D();

  constructor(private shadows = true) {
    this.group.add(this.root);
    this.root.scale.setScalar(SCALE);
    this.fallbackHand.position.set(0, 1.2, 0.3);
    this.group.add(this.fallbackHand);
    // Tarro con hilo en la mano izquierda
    this.reel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.07, 10),
      new THREE.MeshLambertMaterial({ color: '#b8bcc2' }),
    );
    this.reel.rotation.z = Math.PI / 2;
  }

  get ready() {
    return this.mixer !== null;
  }

  async setLook(look: Look) {
    const token = ++this.loadToken;
    const gltf = await loadGLB(`models/characters/character-${look.character}.glb`);
    if (token !== this.loadToken) return; // llegó otro cambio mientras cargaba

    this.root.clear();
    this.mixer?.stopAllAction();
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = this.shadows;
        m.frustumCulled = false;
        m.material = toLambert(m.material as THREE.Material);
      }
    });
    this.root.add(model);
    this.armR = model.getObjectByName('arm-right') as THREE.Bone;
    this.armL = model.getObjectByName('arm-left') as THREE.Bone;
    this.head = model.getObjectByName('head') as THREE.Bone;
    this.armL?.add(this.reel);
    this.reel.position.set(ARM_LEN, 0, 0.02);

    this.mixer = new THREE.AnimationMixer(model);
    this.actions.clear();
    this.current = null;
    this.last = null;
    for (const name of ['idle', 'walk', 'sprint', 'pick-up', 'emote-yes', 'holding-both', 'attack-melee-right', 'die'] as Anim[]) {
      const clip = gltf.animations.find((a) => a.name === name);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.mixer.addEventListener('finished', () => {
      if (this.downTime > 0) return;
      this.oneShot = false;
      this.current = null;
    });
    await this.setAccessories(look);
  }

  async setAccessories(look: Look) {
    for (const a of this.accessories) a.removeFromParent();
    this.accessories = [];
    if (!this.head) return;
    const hat = buildHat(look.hat, look.hatColor);
    if (hat) {
      hat.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = this.shadows) : null));
      this.head.add(hat);
      this.accessories.push(hat);
    }
    if (look.glasses !== 'none') {
      const gltf = await loadGLB(`models/characters/aid-${look.glasses}.glb`);
      const glasses = gltf.scene.clone();
      glasses.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = toLambert(m.material as THREE.Material);
      });
      glasses.position.copy(GLASSES_OFFSET);
      this.head.add(glasses);
      this.accessories.push(glasses);
    }
  }

  private play(name: Anim, fade = 0.2, once = false) {
    if (this.current === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    // Una animación de una vez que terminó queda fija en su último cuadro: hay que fundirla igual
    const prev = this.last !== next ? this.last : null;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.last = next;
    this.current = name;
    this.oneShot = once;
  }

  /** Animación de una vez: recoger un volantín o celebrar un corte. */
  playOnce(name: 'pick-up' | 'emote-yes' | 'attack-melee-right') {
    if (this.downTime > 0) return;
    this.current = null;
    this.play(name, 0.08, true);
  }

  /** s que le quedan botado en el suelo por un charchazo. */
  private downTime = 0;

  /** Queda botado en el suelo `seconds` (charchazo) y después se para solo. */
  knockdown(seconds: number) {
    this.downTime = seconds;
    this.current = null;
    this.play('die', 0.08, true);
  }

  /**
   * Ubica al personaje, lo orienta y elige la animación.
   * Con `kite` sostiene el hilo: el brazo derecho apunta al volantín.
   */
  update(pos: V3, speed: number, kite: V3 | null, facing: number, dt: number) {
    this.group.position.set(pos.x, pos.y, pos.z);
    if (kite) {
      const dx = kite.x - pos.x;
      const dz = kite.z - pos.z;
      if (Math.hypot(dx, dz) > 0.5) this.root.rotation.y = Math.atan2(dx, dz);
    } else {
      this.root.rotation.y = facing;
    }

    if (!this.mixer) return;
    if (this.downTime > 0) {
      this.downTime -= dt;
      this.mixer.update(dt);
      if (this.downTime <= 0) {
        this.oneShot = false;
        this.current = null;
      }
      return;
    }
    if (!this.oneShot) this.play(speed < 0.2 ? 'idle' : speed < 4.2 ? 'walk' : 'sprint');
    this.mixer.update(dt);

    if (kite && !this.oneShot && this.armR && this.armL) {
      this.group.updateMatrixWorld(true);
      this.pointArm(this.armR, RIGHT_ARM_AXIS, kite, 0);
      // El brazo izquierdo sostiene el tarro más abajo, hacia el volantín
      this.pointArm(this.armL, LEFT_ARM_AXIS, kite, -0.9);
    }
  }

  /** Rota el hueso del brazo para que su eje apunte al objetivo. */
  private pointArm(bone: THREE.Bone, axis: THREE.Vector3, target: V3, drop: number) {
    const parent = bone.parent!;
    bone.getWorldPosition(this.tmp);
    this.tmp2.set(target.x - this.tmp.x, target.y - this.tmp.y, target.z - this.tmp.z).normalize();
    this.tmp2.y = Math.max(-0.2, this.tmp2.y + drop);
    this.tmp2.normalize();
    parent.getWorldQuaternion(this.q).invert();
    this.tmp2.applyQuaternion(this.q);
    bone.quaternion.setFromUnitVectors(axis, this.tmp2);
    bone.updateMatrixWorld(true);
  }

  /** Posición de la mano derecha en el mundo: el ancla del hilo. */
  handPosition(out: V3): V3 {
    if (this.armR) this.armR.localToWorld(this.tmp.set(-ARM_LEN, 0, 0));
    else this.fallbackHand.getWorldPosition(this.tmp);
    out.x = this.tmp.x;
    out.y = this.tmp.y;
    out.z = this.tmp.z;
    return out;
  }
}
