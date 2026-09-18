import * as THREE from 'three';
import { DELIVERY_RADIUS, groundHeight, type V3 } from '@volantines/shared';

/** Tu casa: un anillo en el suelo (la zona de entrega) y un letrero que se ve de lejos. Late cuando llevas volantines. */
export class HomeMarker {
  private group = new THREE.Group();
  private ring: THREE.Mesh;
  private sign: THREE.Sprite;

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(DELIVERY_RADIUS - 0.35, DELIVERY_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.ring.renderOrder = 4;

    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(20, 40, 70, 0.75)';
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '72px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏠', 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.sign.scale.set(1.6, 1.6, 1);
    this.sign.renderOrder = 6;

    this.group.add(this.ring, this.sign);
    scene.add(this.group);
  }

  setPosition(p: V3) {
    this.group.position.set(p.x, groundHeight(p.x, p.z), p.z);
  }

  /** `carrying`: la mochila tiene volantines (la casa se destaca). */
  update(time: number, carrying: boolean) {
    const m = this.ring.material as THREE.MeshBasicMaterial;
    m.opacity = carrying ? 0.55 + 0.3 * Math.sin(time * 5) : 0.25;
    this.sign.position.y = 4.2 + (carrying ? 0.3 * Math.sin(time * 3) : 0);
    this.sign.visible = carrying;
  }
}
