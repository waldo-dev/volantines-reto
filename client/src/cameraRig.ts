import * as THREE from 'three';
import { clamp, groundHeight, type V3 } from '@volantines/shared';

const lerpAngle = (a: number, b: number, t: number) => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
};

/** Cámara en tercera persona detrás del personaje, mirando hacia el volantín. */
export class CameraRig {
  yaw = 0;
  zoom = 0.35; // 0 = cerca del personaje, 1 = vista del volantín
  /** Franja reservada arriba de la pantalla (HUD de tensión/viento), en radianes. */
  topMargin = 0;
  readonly forward = new THREE.Vector3(1, 0, 0);
  readonly right = new THREE.Vector3(0, 0, 1);
  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private freeLook = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap(player: V3, kite: V3) {
    this.update(1, player, kite, 0, 0, true);
  }

  /**
   * Con `kite` la cámara mira hacia el volantín; sin él (a pie) la gira el jugador con `turn` (-1..1)
   * y mira hacia adelante.
   */
  update(dt: number, player: V3, kite: V3 | null, zoomDelta: number, turn = 0, instant = false) {
    this.zoom = clamp(this.zoom + zoomDelta, 0, 1);
    if (!kite) {
      this.yaw += turn * dt * 2.2;
      this.freeLook.set(player.x + Math.cos(this.yaw) * 12, player.y + 1.5, player.z + Math.sin(this.yaw) * 12);
      kite = this.freeLook;
    }
    const dx = kite.x - player.x;
    const dz = kite.z - player.z;
    if (Math.hypot(dx, dz) > 1.5) {
      const targetYaw = Math.atan2(dz, dx);
      this.yaw = instant ? targetYaw : lerpAngle(this.yaw, targetYaw, Math.min(1, dt * 1.5));
    }
    this.forward.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);

    // Mientras más alto el volantín, más se aleja la cámara para que entren los dos
    const kiteHeight = Math.max(0, kite.y - player.y);
    const dist = THREE.MathUtils.lerp(5, 16, this.zoom) + kiteHeight * 0.3;
    const height = THREE.MathUtils.lerp(2.2, 6, this.zoom) + kiteHeight * 0.06;
    this.desired.set(player.x - this.forward.x * dist, player.y + height, player.z - this.forward.z * dist);
    const minY = groundHeight(this.desired.x, this.desired.z) + 1;
    if (this.desired.y < minY) this.desired.y = minY;

    const k = instant ? 1 : Math.min(1, dt * 5);
    this.camera.position.lerp(this.desired, k);

    const w = THREE.MathUtils.lerp(0.22, 0.55, this.zoom);
    this.target.set(
      THREE.MathUtils.lerp(player.x, kite.x, w),
      THREE.MathUtils.lerp(player.y + 1.6, kite.y, w),
      THREE.MathUtils.lerp(player.z, kite.z, w),
    );
    this.look.lerp(this.target, instant ? 1 : Math.min(1, dt * 6));

    // Limita la inclinación para que el personaje siga en la parte baja de la pantalla
    const cam = this.camera.position;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const charPitch = Math.atan2(player.y + 0.9 - cam.y, Math.hypot(player.x - cam.x, player.z - cam.z));
    const lx = this.look.x - cam.x;
    const lz = this.look.z - cam.z;
    const lh = Math.max(0.01, Math.hypot(lx, lz));
    let pitch = Math.min(Math.atan2(this.look.y - cam.y, lh), charPitch + halfFov * 0.72);
    // Si el volantín va muy alto, sube la mira lo necesario para que no quede tapado por el HUD.
    const khx = kite.x - cam.x;
    const khz = kite.z - cam.z;
    const kh = Math.max(0.01, Math.hypot(khx, khz));
    const kitePitch = Math.atan2(kite.y - cam.y, kh);
    pitch = Math.max(pitch, kitePitch - (halfFov - this.topMargin));
    this.aim.set(cam.x + lx, cam.y + Math.tan(pitch) * lh, cam.z + lz);
    this.camera.lookAt(this.aim);
  }
}
