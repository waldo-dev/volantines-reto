import * as THREE from 'three';

/** Letrero con el nombre sobre la cabeza; mantiene su tamaño en pantalla. */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;

  constructor(name: string, color = '#ffffff') {
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, depthTest: false, sizeAttenuation: false, transparent: true }),
    );
    this.sprite.scale.set(0.16, 0.04, 1);
    this.sprite.renderOrder = 10;
    this.set(name, color);
  }

  set(name: string, color = '#ffffff') {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = '600 30px system-ui, sans-serif';
    const w = Math.min(248, ctx.measureText(name).width + 28);
    ctx.fillStyle = 'rgba(12, 28, 48, 0.6)';
    ctx.beginPath();
    ctx.roundRect(128 - w / 2, 10, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 33, 236);
    this.texture.needsUpdate = true;
  }
}
