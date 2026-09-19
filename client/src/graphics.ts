/** Opciones de gráficos (fase 0): calidad y tope de cuadros por segundo, guardadas en el navegador. */

export type QualityLevel = 'auto' | 'baja' | 'media' | 'alta';
export type FpsCap = 0 | 30 | 60 | 120;

export interface Graphics {
  quality: QualityLevel;
  /** 0 = sin tope. */
  fps: FpsCap;
}

export const QUALITY_LEVELS: { id: QualityLevel; nombre: string; hint: string }[] = [
  { id: 'auto', nombre: 'Automática', hint: 'Baja sola si el equipo no alcanza 30 FPS' },
  { id: 'baja', nombre: 'Baja', hint: 'Para teléfonos modestos: sin sombras y menos árboles' },
  { id: 'media', nombre: 'Media', hint: 'Equilibrada' },
  { id: 'alta', nombre: 'Alta', hint: 'Sombras y todo el paisaje, a la máxima resolución' },
];

export const FPS_CAPS: { id: FpsCap; nombre: string }[] = [
  { id: 30, nombre: '30' },
  { id: 60, nombre: '60' },
  { id: 120, nombre: '120' },
  { id: 0, nombre: 'Sin tope' },
];

const KEY = 'volantines.graphics';
const DEFAULT: Graphics = { quality: 'auto', fps: 0 };

export function loadGraphics(): Graphics {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Graphics> | null;
    return {
      quality: QUALITY_LEVELS.some((q) => q.id === g?.quality) ? g!.quality! : DEFAULT.quality,
      fps: FPS_CAPS.some((f) => f.id === g?.fps) ? g!.fps! : DEFAULT.fps,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveGraphics(g: Graphics) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // sin almacenamiento solo no se recuerda
  }
}

/** Qué significa cada nivel en este equipo: resolución, sombras y densidad del paisaje. */
export function preset(level: QualityLevel, mobile: boolean) {
  const dpr = window.devicePixelRatio || 1;
  switch (level) {
    case 'baja':
      return { pixelRatio: 1, shadows: false, density: 0.35 };
    case 'media':
      return { pixelRatio: Math.min(dpr, mobile ? 1.25 : 1.5), shadows: !mobile, density: 0.65 };
    case 'alta':
      return { pixelRatio: Math.min(dpr, 2), shadows: true, density: 1 };
    default:
      return { pixelRatio: Math.min(dpr, mobile ? 1.5 : 2), shadows: !mobile, density: mobile ? 0.55 : 1 };
  }
}
