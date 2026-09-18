import * as THREE from 'three';
import { isSpecialDesign, type KiteDesign } from '@volantines/shared';
import { assetUrl } from './assets';

export { PATTERNS, DEFAULT_DESIGN, type KiteDesign } from '@volantines/shared';
export { SPECIAL_DESIGNS as SPECIALS } from '@volantines/shared';

export { COLOR_SWATCHES } from '@volantines/shared';

export const isSpecial = isSpecialDesign;

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(id: string) {
  let p = images.get(id);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = assetUrl(`textures/${id}.webp`);
    });
    images.set(id, p);
  }
  return p;
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Dibuja el diseño en un cuadrado de lado `s`. El volantín muestra el rombo inscrito
 * (puntas arriba, abajo, izquierda y derecha), así que el motivo va centrado.
 */
export async function drawDesign(ctx: CanvasRenderingContext2D, d: KiteDesign, s: number) {
  const [a, b, c] = d.colors;
  const h = s / 2;
  ctx.save();
  ctx.clearRect(0, 0, s, s);
  if (isSpecial(d.pattern)) {
    try {
      ctx.drawImage(await loadImage(d.pattern), 0, 0, s, s);
    } catch {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, s, s);
    }
  } else {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    switch (d.pattern) {
      case 'cuartos':
        ctx.fillStyle = b;
        ctx.fillRect(h, 0, h, h);
        ctx.fillRect(0, h, h, h);
        break;
      case 'mitades':
        ctx.fillStyle = b;
        ctx.fillRect(h, 0, h, s);
        ctx.fillStyle = c;
        ctx.fillRect(0, h * 1.45, s, s);
        break;
      case 'franjas':
        ctx.fillStyle = b;
        ctx.fillRect(0, s / 3, s, s / 3);
        ctx.fillStyle = c;
        ctx.fillRect(0, (2 * s) / 3, s, s / 3);
        break;
      case 'estrella':
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(h, h, s * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = b;
        star(ctx, h, h, s * 0.26);
        break;
      case 'chile':
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, s, h);
        ctx.fillStyle = '#d52b1e';
        ctx.fillRect(0, h, s, h);
        ctx.fillStyle = '#0039a6';
        ctx.fillRect(s * 0.25, s * 0.25, h * 0.5, h * 0.5);
        ctx.fillStyle = '#ffffff';
        star(ctx, s * 0.375, s * 0.375, s * 0.09);
        break;
      case 'ojo':
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(h, h, s * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(h, h, s * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'rombos':
        for (let i = 0; i < 4; i++) {
          const r = h * (1 - i * 0.25);
          ctx.fillStyle = [a, b, c, b][i];
          ctx.beginPath();
          ctx.moveTo(h, h - r);
          ctx.lineTo(h + r, h);
          ctx.lineTo(h, h + r);
          ctx.lineTo(h - r, h);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case 'rayos':
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = i % 2 ? b : a;
          ctx.beginPath();
          ctx.moveTo(h, h);
          ctx.arc(h, h, s, (i * Math.PI) / 6, ((i + 1) * Math.PI) / 6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(h, h, s * 0.12, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }
  // Orilla de papel doblado alrededor del rombo
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = s * 0.025;
  ctx.beginPath();
  ctx.moveTo(h, 1);
  ctx.lineTo(s - 1, h);
  ctx.lineTo(h, s - 1);
  ctx.lineTo(1, h);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Textura del volantín; se actualiza sola cuando termina de cargar la imagen de un diseño especial. */
export function designTexture(d: KiteDesign): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  void drawDesign(canvas.getContext('2d')!, d, 256).then(() => (tex.needsUpdate = true));
  return tex;
}
