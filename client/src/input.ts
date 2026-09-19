import { clamp } from '@volantines/shared';

/** setPointerCapture falla si el puntero ya no existe; no debe cortar el manejo del toque. */
function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    // sin captura el gesto sigue funcionando mientras el dedo no salga del elemento
  }
}

/** Entrada unificada: el resto del juego no sabe si viene de teclado, mouse o pantalla táctil. */
export interface InputState {
  tirar: boolean;
  soltar: boolean;
  dirX: number; // -1..1
  moveX: number; // -1..1 derecha
  moveY: number; // -1..1 adelante
  /** Tirón seco pedido: queda en true hasta que el juego lo usa (ver `consumeTiron`). */
  tiron: boolean;
  /** Dar cuerda rápido (largada): doble toque en soltar y mantener, o la tecla C. */
  rapido: boolean;
}

/** Dos toques de soltar más cerca que esto (ms) = dar cuerda rápido. */
const DOUBLE_TAP_MS = 320;

/** Detecta el doble toque en un botón que se mantiene apretado. */
class DoubleTap {
  private lastDown = 0;
  held = false;
  rapid = false;
  down() {
    const now = performance.now();
    this.rapid = now - this.lastDown < DOUBLE_TAP_MS;
    this.lastDown = now;
    this.held = true;
  }
  up() {
    this.held = false;
    this.rapid = false;
  }
}

export class Input {
  readonly state: InputState = { tirar: false, soltar: false, dirX: 0, moveX: 0, moveY: 0, tiron: false, rapido: false };
  isTouch = false;
  /** Con el menú abierto el juego no recibe entradas. */
  enabled = true;

  private keys = new Set<string>();
  private mouseTirar = false;
  private mouseSoltar = new DoubleTap();
  private keySoltar = new DoubleTap();
  private touchSoltar = new DoubleTap();
  private tironRequested = false;
  /** Botón táctil del tirón (para mostrar enfriamiento y el momento del crítico). */
  private tironBtn: HTMLElement | null = null;
  private hitBtn: HTMLElement | null = null;
  private hitRequested = false;
  private mouseDirX = 0;
  private zoomDelta = 0;
  /** Movimiento horizontal del mouse acumulado (px), para girar la cámara a pie. */
  private mouseDX = 0;
  private resetRequested = false;
  private debugRequested = false;
  private menuRequested = false;

  private touch = { tirar: false, dirX: 0, moveX: 0, moveY: 0 };

  constructor(private canvas: HTMLCanvasElement, private touchRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.resetRequested = true;
      if (e.code === 'KeyG') this.debugRequested = true;
      if (e.code === 'KeyM' || e.code === 'Escape') this.menuRequested = true;
      if (e.code === 'KeyF') this.tironRequested = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keySoltar.down();
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !this.keys.has('ShiftLeft') && !this.keys.has('ShiftRight')) this.keySoltar.up();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseTirar = false;
      this.mouseSoltar.up();
      this.keySoltar.up();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Clic del medio = tirón: que no active el desplazamiento automático del navegador
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseTirar = true;
      if (e.button === 1) {
        e.preventDefault();
        this.tironRequested = true;
      }
      if (e.button === 2) this.mouseSoltar.down();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseTirar = false;
      if (e.button === 2) this.mouseSoltar.up();
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseDX += e.movementX;
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseDirX = Math.abs(x) < 0.08 ? 0 : clamp((x - Math.sign(x) * 0.08) / 0.7, -1, 1);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomDelta += e.deltaY * 0.0012;
      },
      { passive: false },
    );

    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (coarse) this.enableTouch();
    // Si llega un toque en un equipo que no parecía táctil, se activan los controles igual
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.isTouch) this.enableTouch();
    });
  }

  /** Lee y consume los eventos de un solo disparo. */
  consumeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  /** Cuánto girar la cámara a pie (rad): con mouse sigue el movimiento, en táctil el arrastre. */
  consumeTurn(dt: number): number {
    const dx = this.mouseDX;
    this.mouseDX = 0;
    if (!this.enabled) return 0;
    return this.isTouch ? this.touch.dirX * dt * 2.2 : dx * 0.005 + ((this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0)) * dt * 2.2;
  }

  consumeReset(): boolean {
    const r = this.resetRequested;
    this.resetRequested = false;
    return r;
  }

  /** Tecla V apretada (hablar por la voz de la sala). */
  get talkHeld() {
    return this.keys.has('KeyV');
  }

  consumeDebug(): boolean {
    const d = this.debugRequested;
    this.debugRequested = false;
    return d;
  }

  consumeMenu(): boolean {
    const m = this.menuRequested;
    this.menuRequested = false;
    return m;
  }

  requestReset() {
    this.resetRequested = true;
  }

  /** El juego ya usó el tirón pedido. */
  consumeTiron() {
    this.state.tiron = false;
  }

  /**
   * Estado del botón táctil del tirón: `ready` sin enfriamiento, `hot` justo al cruzarse
   * (el momento del golpe crítico).
   */
  setTironState(visible: boolean, ready: boolean, hot: boolean) {
    const b = this.tironBtn;
    if (!b) return;
    b.hidden = !visible;
    b.classList.toggle('cooling', !ready);
    b.classList.toggle('hot', hot && ready);
  }

  /** Botón táctil GOLPEAR: se ve a pie y se enciende cuando hay alguien al alcance. */
  setHitState(visible: boolean, ready: boolean) {
    const b = this.hitBtn;
    if (!b) return;
    b.hidden = !visible;
    b.classList.toggle('ready', ready);
  }

  /** Se apretó el botón GOLPEAR (una vez por toque). */
  consumeHit(): boolean {
    const h = this.hitRequested;
    this.hitRequested = false;
    return h;
  }

  update(): InputState {
    const k = this.keys;
    const s = this.state;
    if (!this.enabled) {
      s.tirar = s.soltar = s.tiron = s.rapido = false;
      s.dirX = s.moveX = s.moveY = 0;
      this.tironRequested = false;
      this.hitRequested = false;
      return s;
    }
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const keySteer = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);

    s.tirar = this.mouseTirar || k.has('Space') || this.touch.tirar;
    s.soltar = this.mouseSoltar.held || this.keySoltar.held || this.touchSoltar.held || k.has('KeyC');
    s.rapido = this.mouseSoltar.rapid || this.keySoltar.rapid || this.touchSoltar.rapid || k.has('KeyC');
    if (this.tironRequested) {
      s.tiron = true;
      this.tironRequested = false;
    }
    s.dirX = keySteer !== 0 ? keySteer : this.isTouch ? this.touch.dirX : this.mouseDirX;
    s.moveX = clamp(kx + this.touch.moveX, -1, 1);
    s.moveY = clamp(ky + this.touch.moveY, -1, 1);
    return s;
  }

  private enableTouch() {
    this.isTouch = true;
    this.mouseDirX = 0;
    const root = this.touchRoot;
    root.hidden = false;
    root.innerHTML = `
      <div class="joy-zone"><div class="joy-base" hidden><div class="joy-knob"></div></div></div>
      <div class="steer-zone"><span class="steer-hint">Arrastra para dirigir · pellizca para zoom</span></div>
      <div class="release-btn">SOLTAR<small>2× rápido</small></div>
      <div class="pull-btn">TIRAR</div>
      <div class="tiron-btn" hidden>⚡<small>TIRÓN</small></div>
      <div class="hit-btn" hidden>👋<small>GOLPEAR</small></div>
      <button class="touch-btn reset-btn">↺ Reiniciar</button>
    `;
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.bindJoystick($('.joy-zone'), $('.joy-base'), $('.joy-knob'));
    this.bindSteer($('.steer-zone'));
    this.bindHold($('.pull-btn'), (v) => (this.touch.tirar = v));
    this.bindHold($('.release-btn'), (v) => (v ? this.touchSoltar.down() : this.touchSoltar.up()));
    this.tironBtn = $('.tiron-btn');
    this.bindHold(this.tironBtn, (v) => {
      if (v) this.tironRequested = true;
    });
    this.hitBtn = $('.hit-btn');
    this.bindHold(this.hitBtn, (v) => {
      if (v) this.hitRequested = true;
    });
    $('.reset-btn').addEventListener('click', () => this.requestReset());
  }

  private bindHold(el: HTMLElement, set: (v: boolean) => void) {
    const on = (e: PointerEvent) => {
      e.preventDefault();
      capture(el, e.pointerId);
      el.classList.add('active');
      set(true);
    };
    const off = () => {
      el.classList.remove('active');
      set(false);
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  private bindJoystick(zone: HTMLElement, base: HTMLElement, knob: HTMLElement) {
    const RADIUS = 55;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      capture(zone, id);
      const r = zone.getBoundingClientRect();
      cx = e.clientX;
      cy = e.clientY;
      base.style.left = `${cx - r.left}px`;
      base.style.top = `${cy - r.top}px`;
      base.hidden = false;
      knob.style.transform = '';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.moveX = dx / RADIUS;
      this.touch.moveY = -dy / RADIUS;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      base.hidden = true;
      this.touch.moveX = this.touch.moveY = 0;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private bindSteer(zone: HTMLElement) {
    const RANGE = 90;
    const pointers = new Map<number, { x: number; y: number; startX: number }>();
    let pinchDist = 0;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    zone.addEventListener('pointerdown', (e) => {
      capture(zone, e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX });
      if (pointers.size === 2) {
        pinchDist = spread();
        this.touch.dirX = 0;
      }
    });
    zone.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2) {
        const d = spread();
        this.zoomDelta -= (d - pinchDist) * 0.004;
        pinchDist = d;
      } else {
        this.touch.dirX = clamp((p.x - p.startX) / RANGE, -1, 1);
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) this.touch.dirX = 0;
      else for (const p of pointers.values()) p.startX = p.x;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
