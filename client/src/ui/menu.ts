import * as THREE from 'three';
import { ACHIEVEMENTS, BRIDLES, KITES, LINES, REELS, breakThreshold, catalogItem } from '@volantines/shared';
import { Character } from '../entities/character';
import { COLOR_SWATCHES, PATTERNS, SPECIALS, drawDesign, isSpecial, type KiteDesign } from '../kiteDesigns';
import { CHARACTERS, GLASSES, HATS, type Look } from '../profile';
import type { Session } from '../session';

type Tab = 'jugar' | 'cuenta' | 'personaje' | 'volantin' | 'equipo';

export interface NetControls {
  /** null = modo solo; '' = partida rápida; 'NUEVA' = sala privada; otro = código de sala. */
  play: (room: string | null) => Promise<void>;
  status: () => { room: string; isPrivate: boolean; players: string[] } | null;
}
export type MenuChange = 'look' | 'design' | 'gear' | 'name' | 'account';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Menú: cuenta y progreso, personaje, diseño del volantín y equipo (con candados y tienda). */
export class Menu {
  readonly el: HTMLElement;
  private tab: Tab;
  private body: HTMLElement;
  private preview: CharacterPreview | null = null;
  private kiteCanvas: HTMLCanvasElement;
  private colorSlot = 0;
  private status = '';

  constructor(
    private session: Session,
    private onChange: (what: MenuChange) => void,
    private onClose: () => void,
    private net: NetControls,
  ) {
    this.tab = 'jugar';
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="menu-card">
        <header>
          <h1>volantines<span>-reto</span></h1>
          <div class="menu-wallet"></div>
          <button class="play">¡A encumbrar!</button>
        </header>
        <nav>
          <button data-tab="jugar">Jugar</button>
          <button data-tab="cuenta">Cuenta</button>
          <button data-tab="personaje">Personaje</button>
          <button data-tab="volantin">Volantín</button>
          <button data-tab="equipo">Equipo</button>
        </nav>
        <div class="menu-body">
          <div class="menu-preview">
            <canvas class="char-preview"></canvas>
            <canvas class="kite-preview" width="220" height="220"></canvas>
          </div>
          <div class="menu-options"></div>
        </div>
        <div class="menu-status" hidden></div>
      </div>`;
    document.body.appendChild(this.el);
    this.body = this.el.querySelector('.menu-options')!;
    this.kiteCanvas = this.el.querySelector('.kite-preview')!;
    this.el.querySelector('.play')!.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        this.status = '';
        this.render();
      }),
    );
    // Evita que los toques y teclas del menú lleguen al juego
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get open() {
    return !this.el.hidden;
  }

  show(tab?: Tab) {
    if (tab) this.tab = tab;
    this.el.hidden = false;
    if (!this.preview) this.preview = new CharacterPreview(this.el.querySelector('.char-preview')!);
    this.preview.start(this.session.data.look);
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.preview?.stop();
    this.onClose();
  }

  /** Vuelve a dibujar (por ejemplo cuando cambian monedas o nivel). */
  refresh() {
    if (this.open) this.render();
  }

  private setStatus(msg: string) {
    this.status = msg;
    const el = this.el.querySelector<HTMLElement>('.menu-status')!;
    el.textContent = msg;
    el.hidden = !msg;
  }

  private render() {
    const s = this.session;
    const lvl = s.level;
    this.el.querySelector('.menu-wallet')!.innerHTML = `<span>Nivel <b>${lvl.level}</b></span><span>🪙 <b>${s.data.coins}</b></span>`;
    this.el.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.el.querySelector<HTMLCanvasElement>('.char-preview')!.hidden = this.tab === 'volantin';
    this.el.querySelector<HTMLElement>('.menu-preview')!.hidden = this.tab === 'jugar';
    this.el.querySelector<HTMLElement>('.menu-body')!.classList.toggle('single', this.tab === 'jugar');
    this.kiteCanvas.hidden = this.tab !== 'volantin';
    this.body.innerHTML = '';
    if (this.tab === 'jugar') this.renderPlay();
    else if (this.tab === 'cuenta') this.renderAccount();
    else if (this.tab === 'personaje') this.renderCharacter();
    else if (this.tab === 'volantin') this.renderKite();
    else this.renderGear();
    this.setStatus(this.status);
  }

  // --- Helpers de UI ---

  private section(title: string, hint?: string) {
    const s = document.createElement('section');
    s.innerHTML = `<h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}<div class="opts"></div>`;
    this.body.appendChild(s);
    return s.querySelector('.opts') as HTMLElement;
  }

  private option(parent: HTMLElement, label: string, selected: boolean, onPick: () => void, extra = '') {
    const b = document.createElement('button');
    b.className = `opt${selected ? ' on' : ''}`;
    b.innerHTML = `${extra}<span>${label}</span>`;
    b.addEventListener('click', onPick);
    parent.appendChild(b);
    return b;
  }

  /** Opción de la tienda: se elige si es tuya; si no, muestra candado o precio y se compra con un clic. */
  private shopOption(parent: HTMLElement, key: string, label: string, selected: boolean, onPick: () => void, extra = '') {
    const owned = this.session.owns(key);
    const item = catalogItem(key)!;
    const lvl = this.session.level.level;
    let badge = '';
    if (!owned) badge = lvl < item.nivel ? `<em class="lock">🔒 Nivel ${item.nivel}</em>` : `<em class="price">🪙 ${item.precio}</em>`;
    const b = this.option(parent, label, selected && owned, () => (owned ? onPick() : void this.buy(key, onPick)), extra + badge);
    if (!owned) b.classList.add(lvl < item.nivel ? 'locked' : 'buyable');
    return b;
  }

  private async buy(key: string, then: () => void) {
    const err = this.session.buyError(key);
    if (err) return this.setStatus(err);
    const item = catalogItem(key)!;
    if (!confirm(`¿Comprar ${item.nombre} por ${item.precio} monedas?`)) return;
    try {
      await this.session.buy(key);
      this.status = `¡Compraste ${item.nombre}!`;
      then();
    } catch (e) {
      this.setStatus((e as Error).message);
    }
  }

  private swatches(parent: HTMLElement, current: string, onPick: (c: string) => void) {
    for (const c of COLOR_SWATCHES) {
      const b = document.createElement('button');
      b.className = `swatch${c.toLowerCase() === current.toLowerCase() ? ' on' : ''}`;
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => onPick(c));
      parent.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.value = current;
    custom.title = 'Otro color';
    custom.addEventListener('change', () => onPick(custom.value));
    parent.appendChild(custom);
  }

  private setLook(patch: Partial<Look>) {
    const look = { ...this.session.data.look, ...patch };
    void this.session.saveCustomization({ look });
    this.preview?.setLook(look);
    this.onChange('look');
    this.render();
  }

  private setDesign(patch: Partial<KiteDesign>) {
    void this.session.saveCustomization({ design: { ...this.session.data.design, ...patch } });
    this.onChange('design');
    this.render();
  }

  private setGear(kind: 'kite' | 'line' | 'reel' | 'bridle', id: string) {
    void this.session.saveCustomization({ gear: { ...this.session.data.gear, [kind]: id } });
    this.onChange('gear');
    this.render();
  }

  // --- Pestañas ---

  private busy = false;

  private async play(room: string | null, closeAfter = true) {
    if (this.busy) return;
    this.busy = true;
    this.setStatus(room === null ? 'Volviendo al modo solo…' : 'Conectando…');
    try {
      await this.net.play(room);
      this.status = '';
      if (closeAfter) this.close();
      else this.render();
    } catch (e) {
      this.setStatus((e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private renderPlay() {
    const st = this.net.status();
    if (st) {
      const box = document.createElement('section');
      box.innerHTML = `
        <h3>Estás en la sala <span class="room-code">${esc(st.room)}</span></h3>
        <p class="hint">${st.isPrivate ? 'Sala privada: comparte este código con tus amigos para que entren.' : 'Sala pública de partida rápida.'}</p>
        <ul class="stat-list">${st.players.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
      this.body.appendChild(box);
      const copy = document.createElement('button');
      copy.className = 'opt';
      copy.textContent = 'Copiar código';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(st.room);
        this.setStatus('Código copiado.');
      });
      const leave = document.createElement('button');
      leave.className = 'opt';
      leave.textContent = 'Salir de la sala (jugar solo)';
      leave.addEventListener('click', () => void this.play(null, false));
      const row = document.createElement('div');
      row.className = 'opts';
      row.append(copy, leave);
      this.body.appendChild(row);
      return;
    }

    const modes = this.section('¿Cómo quieres jugar?');
    modes.classList.add('play-modes');
    const card = (title: string, text: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'opt play-card';
      b.innerHTML = `<b>${title}</b><small>${text}</small>`;
      b.addEventListener('click', onClick);
      modes.appendChild(b);
    };
    card('🪁 Solo con bots', 'Practica contra Pancho, La Rucia y compañía.', () => this.close());
    card('🌐 Partida rápida', 'Entra a una sala con otros jugadores online.', () => void this.play(''));
    card('🔒 Crear sala privada', 'Te damos un código para invitar a tus amigos.', () => void this.play('NUEVA'));

    const join = this.section('Unirse con código', 'Pídele el código de 5 letras a quien creó la sala.');
    const form = document.createElement('form');
    form.className = 'name-form';
    form.innerHTML = `<input maxlength="5" placeholder="ABCDE" style="text-transform:uppercase" /><button class="opt">Entrar</button>`;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = form.querySelector('input')!.value.trim().toUpperCase();
      if (!/^[A-Z]{5}$/.test(code)) return this.setStatus('El código son 5 letras.');
      void this.play(code);
    });
    join.appendChild(form);
  }

  private renderAccount() {
    const s = this.session;
    if (s.isGuest) {
      const box = document.createElement('section');
      box.innerHTML = `
        <h3>Tu cuenta</h3>
        <p class="hint">Estás jugando como invitado: tu progreso queda solo en este navegador.
        Crea una cuenta para guardar tus logros, monedas y volantines, y jugar desde cualquier equipo.</p>
        <form class="auth">
          <label>Nombre <input name="name" maxlength="16" autocomplete="username" required /></label>
          <label>Clave <input name="password" type="password" minlength="4" autocomplete="current-password" required /></label>
          <div class="auth-buttons">
            <button type="submit" data-mode="login" class="opt">Entrar</button>
            <button type="submit" data-mode="register" class="opt on">Crear cuenta</button>
          </div>
        </form>`;
      this.body.appendChild(box);
      const form = box.querySelector('form')!;
      let mode = 'register';
      form.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => (mode = b.dataset.mode!)));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') ?? '').trim();
        const password = String(fd.get('password') ?? '');
        try {
          if (mode === 'login') await s.login(name, password);
          else await s.register(name, password);
          this.status = `¡Hola, ${s.data.name}!`;
          this.onChange('account');
          this.preview?.setLook(s.data.look);
          this.render();
        } catch (err) {
          this.setStatus((err as Error).message);
        }
      });
    }

    const lvl = s.level;
    const st = s.data.stats;
    const summary = document.createElement('section');
    summary.innerHTML = `
      <h3>${esc(s.data.name)}${s.isGuest && s.data.name !== 'Invitado' ? ' (invitado)' : ''}</h3>
      <div class="level-row"><span>Nivel <b>${lvl.level}</b></span><div class="bar"><div style="width:${((lvl.into / lvl.need) * 100).toFixed(1)}%"></div></div><small>${lvl.into} / ${lvl.need} XP</small></div>
      <ul class="stat-list">
        <li><b>${st.cuts}</b> cortes</li>
        <li><b>${st.captures}</b> capturas</li>
        <li><b>${Math.floor(st.flightSeconds / 60)}</b> min volando</li>
        <li><b>${st.bestAltitude}</b> m de altura máx.</li>
        <li><b>${st.cutBy}</b> veces cortado</li>
      </ul>`;
    this.body.appendChild(summary);

    const ach = this.section('Logros', `${s.data.achievements.length} de ${ACHIEVEMENTS.length}`);
    ach.classList.add('achievements');
    for (const a of ACHIEVEMENTS) {
      const done = s.data.achievements.includes(a.id);
      const d = document.createElement('div');
      d.className = `achievement${done ? ' done' : ''}`;
      d.innerHTML = `<b>${done ? '🏆' : '🔒'} ${a.nombre}</b><small>${a.descripcion} · 🪙 ${a.monedas}</small>`;
      ach.appendChild(d);
    }

    if (s.data.captured.length) {
      const gal = this.section('Volantines capturados', 'Puedes volar cualquiera de estos diseños.');
      gal.classList.add('grid');
      s.data.captured.forEach((d, i) => {
        const thumb = document.createElement('canvas');
        thumb.width = thumb.height = 64;
        void drawKitePreview(thumb, d);
        const b = this.option(gal, `#${i + 1}`, false, () => {
          this.setDesign({ ...d, pattern: isSpecial(d.pattern) && !s.owns(`design:${d.pattern}`) ? 'cuartos' : d.pattern });
          this.status = 'Diseño aplicado a tu volantín.';
          this.render();
        });
        b.prepend(thumb);
      });
    }

    if (!s.isGuest) {
      const out = document.createElement('button');
      out.className = 'opt';
      out.textContent = 'Cerrar sesión';
      out.addEventListener('click', async () => {
        await s.logout();
        this.onChange('account');
        this.render();
      });
      this.body.appendChild(out);
    }
  }

  private renderCharacter() {
    const look = this.session.data.look;
    const nameSec = this.section('Nombre', this.session.isGuest ? 'Como invitado el nombre queda en este navegador.' : 'Así te verán los demás.');
    const form = document.createElement('form');
    form.className = 'name-form';
    form.innerHTML = `<input maxlength="16" value="${esc(this.session.data.name)}" /><button class="opt">Guardar</button>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.querySelector('input')!.value.trim();
      if (!/^[\p{L}\p{N} _-]{3,16}$/u.test(name)) return this.setStatus('El nombre debe tener entre 3 y 16 letras o números.');
      const before = this.session.data.name;
      try {
        await this.session.saveCustomization({ name }, true);
        this.status = 'Nombre guardado.';
        this.onChange('name');
        this.render();
      } catch (err) {
        this.session.data.name = before;
        this.setStatus((err as Error).message);
      }
    });
    nameSec.appendChild(form);

    const chars = this.section('Personaje');
    chars.classList.add('grid');
    for (const c of CHARACTERS) this.option(chars, c.nombre, look.character === c.id, () => this.setLook({ character: c.id }));
    const hats = this.section('Gorro');
    for (const h of HATS) this.option(hats, h.nombre, look.hat === h.id, () => this.setLook({ hat: h.id }));
    if (look.hat !== 'none') {
      const colors = this.section(look.hat === 'chupalla' ? 'Color de la cinta' : 'Color del gorro');
      this.swatches(colors, look.hatColor, (c) => this.setLook({ hatColor: c }));
    }
    const glasses = this.section('Lentes');
    for (const g of GLASSES) this.option(glasses, g.nombre, look.glasses === g.id, () => this.setLook({ glasses: g.id }));
  }

  private renderKite() {
    const d = this.session.data.design;
    void drawKitePreview(this.kiteCanvas, d);

    const patterns = this.section('Diseño', 'Elige un patrón y píntalo con tus colores.');
    patterns.classList.add('grid');
    for (const p of PATTERNS) {
      const thumb = document.createElement('canvas');
      thumb.width = thumb.height = 64;
      void drawKitePreview(thumb, { ...d, pattern: p.id });
      this.option(patterns, p.nombre, d.pattern === p.id, () => this.setDesign({ pattern: p.id })).prepend(thumb);
    }
    const specials = this.section('Diseños especiales', 'Ilustrados. Se compran con monedas.');
    specials.classList.add('grid');
    for (const p of SPECIALS) {
      const thumb = document.createElement('canvas');
      thumb.width = thumb.height = 64;
      void drawKitePreview(thumb, { ...d, pattern: p.id });
      this.shopOption(specials, `design:${p.id}`, p.nombre, d.pattern === p.id, () => this.setDesign({ pattern: p.id })).prepend(thumb);
    }

    if (!isSpecial(d.pattern) && d.pattern !== 'chile') {
      const slots = this.section('Colores del papel');
      ['Color 1', 'Color 2', 'Color 3'].forEach((label, i) => {
        const b = this.option(slots, label, this.colorSlot === i, () => {
          this.colorSlot = i;
          this.render();
        });
        b.style.setProperty('--dot', d.colors[i]);
        b.classList.add('slot');
      });
      const pick = this.section('');
      this.swatches(pick, d.colors[this.colorSlot], (c) => {
        const colors = [...d.colors] as KiteDesign['colors'];
        colors[this.colorSlot] = c;
        this.setDesign({ colors });
      });
    }
    const tail = this.section('Color de la cola');
    this.swatches(tail, d.tail, (c) => this.setDesign({ tail: c }));
  }

  private renderGear() {
    const g = this.session.data.gear;
    const size = this.section('Tamaño del volantín', 'Más grande tensa más el hilo (corta mejor) pero sube más lento.');
    for (const k of KITES) this.shopOption(size, `kite:${k.id}`, k.nombre, g.kite === k.id, () => this.setGear('kite', k.id), `<small>${k.area} m²</small>`);
    const bridle = this.section('Tirantes', 'Cómo va amarrado el hilo: cambia el carácter del volantín en el aire.');
    for (const b of BRIDLES) this.shopOption(bridle, `bridle:${b.id}`, b.nombre, g.bridle === b.id, () => this.setGear('bridle', b.id), `<small>${b.descripcion}</small>`);
    const line = this.section('Hilo', 'Mientras más curado, más corta y más aguanta.');
    for (const l of LINES) {
      this.shopOption(line, `line:${l.id}`, l.nombre, g.line === l.id, () => this.setGear('line', l.id), `<small>filo ${l.filo} · aguanta ${breakThreshold(l).toFixed(0)} N</small>`);
    }
    const reel = this.section('Carrete');
    for (const r of REELS) this.shopOption(reel, `reel:${r.id}`, r.nombre, g.reel === r.id, () => this.setGear('reel', r.id), `<small>${r.maxLine} m de hilo</small>`);
  }
}

/** Dibuja el volantín (rombo con varillas) en un canvas 2D. */
export async function drawKitePreview(canvas: HTMLCanvasElement, design: KiteDesign) {
  const s = canvas.width;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = 256;
  await drawDesign(tmp.getContext('2d')!, design, 256);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  const m = s * 0.06;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(s / 2, m);
  ctx.lineTo(s - m, s / 2);
  ctx.lineTo(s / 2, s - m);
  ctx.lineTo(m, s / 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(tmp, m, m, s - 2 * m, s - 2 * m);
  ctx.restore();
  ctx.strokeStyle = 'rgba(90,60,30,0.7)';
  ctx.lineWidth = Math.max(1, s / 90);
  ctx.beginPath();
  ctx.moveTo(s / 2, m);
  ctx.lineTo(s / 2, s - m);
  ctx.moveTo(m, s / 2);
  ctx.quadraticCurveTo(s / 2, s / 2 - s * 0.12, s - m, s / 2);
  ctx.stroke();
}

/** Vista previa 3D del personaje, con su propio renderer pequeño. */
class CharacterPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private character = new Character(false);
  private raf = 0;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8aa070', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 1.5);
    key.position.set(2, 4, 3);
    this.scene.add(key, this.character.group);
    this.camera.position.set(0, 1.1, 5.2);
    this.camera.lookAt(0, 0.8, 0);
  }

  start(look: Look) {
    void this.character.setLook(look);
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w && this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        // En paneles angostos se aleja para que el personaje entre completo
        this.camera.position.set(0, 1.1, 5.2 / Math.min(1, this.camera.aspect * 1.4));
        this.camera.lookAt(0, 0.8, 0);
        this.camera.updateProjectionMatrix();
      }
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.character.update({ x: 0, y: 0, z: 0 }, 0, null, Math.sin(now / 1600) * 0.6, dt);
      this.renderer.render(this.scene, this.camera);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  setLook(look: Look) {
    void this.character.setLook(look);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
