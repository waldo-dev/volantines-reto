export interface HudData {
  flying: boolean;
  altitude: number;
  lineLength: number;
  maxLine: number;
  stress: number; // 1 = desde aquí el hilo se empieza a gastar
  wear: number; // 0..1, desgaste por sobretensión
  integrity: number; // 0..100, desgaste por cruce con otros hilos
  crossingWith: string | null;
  windSpeed: number; // m/s
  windScreenAngle: number; // rad, 0 = hacia adelante de la cámara
  /** Volantín caído más cercano: distancia y ángulo en pantalla. */
  fallen: { dist: number; angle: number } | null;
}

export interface HudPlayer {
  name: string;
  level: number;
  xpInto: number;
  xpNeed: number;
  coins: number;
  guest: boolean;
}

export class Hud {
  private $: (sel: string) => HTMLElement;
  private onAction: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onLaunch: (() => void) | null = null;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="panel player-card">
        <div class="pc-top"><b data-name>Invitado</b><span class="pc-coins">🪙 <b data-coins>0</b></span></div>
        <div class="pc-level"><span>Nivel <b data-level>1</b></span><div class="bar"><div class="xp-fill"></div></div></div>
      </div>
      <div class="panel stats">
        <div><span class="label">Altura</span><b data-alt>0</b> m</div>
        <div><span class="label">Hilo</span><b data-len>0</b> / <span data-max>80</span> m</div>
      </div>
      <button class="panel menu-btn">🎨 Personalizar</button>
      <button class="panel fs-btn" hidden title="Pantalla completa">⛶</button>
      <div class="panel tension">
        <span class="label">Tensión del hilo</span><div class="bar"><div class="fill"></div></div>
        <div class="wear" hidden><span class="label">Desgaste</span><div class="bar"><div class="wear-fill"></div></div></div>
        <div class="integrity" hidden><span class="label" data-cross>Cruzado</span><div class="bar"><div class="int-fill"></div></div></div>
      </div>
      <div class="panel wind"><div class="vane"><div class="arrow">↑</div></div><div><span class="label">Viento</span><b data-wind>0</b> km/h</div></div>
      <div class="panel room-chip" hidden></div>
      <div class="panel fallen" hidden><span class="fallen-arrow">↑</span> Volantín caído a <b data-fdist>0</b> m</div>
      <button class="panel launch-btn" hidden>🪁 Encumbrar</button>
      <div class="panel message" hidden><div data-msg></div><button data-action></button></div>
      <div class="toasts"></div>
      <div class="panel help">
        <kbd>W A S D</kbd> caminar · <kbd>Clic izq.</kbd>/<kbd>Espacio</kbd> tirar · <kbd>Clic der.</kbd>/<kbd>Shift</kbd> soltar ·
        <kbd>Mouse</kbd>/<kbd>Q E</kbd> dirigir · <kbd>Rueda</kbd> zoom · <kbd>R</kbd> encumbrar · <kbd>M</kbd> menú · <kbd>G</kbd> ajustes<br />
        Tira cuando la punta apunte hacia arriba. Recoge todo el hilo para guardar el volantín y salir a buscar los caídos.
      </div>
    `;
    this.$ = (sel: string) => root.querySelector(sel) as HTMLElement;
    this.$('[data-action]').addEventListener('click', () => this.onAction?.());
    this.$('.menu-btn').addEventListener('click', () => this.onMenu?.());
    this.$('.launch-btn').addEventListener('click', () => this.onLaunch?.());
    this.$('.fs-btn').addEventListener('click', () => this.onFullscreen?.());
  }

  onFullscreen: (() => void) | null = null;

  /** Indicador de sala online (null en modo solo). */
  setRoom(text: string | null) {
    const el = this.$('.room-chip');
    el.hidden = !text;
    el.textContent = text ? `🌐 ${text}` : '';
  }

  setTouch(isTouch: boolean) {
    this.$('.help').hidden = isTouch;
    this.$('.fs-btn').hidden = !isTouch || !document.fullscreenEnabled || !!document.fullscreenElement;
  }

  setPlayer(p: HudPlayer) {
    this.$('[data-name]').textContent = p.guest && p.name !== 'Invitado' ? `${p.name} (invitado)` : p.name;
    this.$('[data-coins]').textContent = String(p.coins);
    this.$('[data-level]').textContent = String(p.level);
    this.$('.xp-fill').style.width = `${((p.xpInto / p.xpNeed) * 100).toFixed(1)}%`;
  }

  update(d: HudData, dt: number) {
    this.$('.stats').style.opacity = d.flying ? '1' : '0.45';
    this.$('[data-alt]').textContent = d.flying ? Math.max(0, d.altitude).toFixed(0) : '–';
    this.$('[data-len]').textContent = d.lineLength.toFixed(0);
    this.$('[data-max]').textContent = d.maxLine.toFixed(0);
    const tension = this.$('.tension');
    tension.hidden = !d.flying;
    const s = Math.min(1, d.stress);
    const fill = this.$('.fill');
    fill.style.width = `${(s * 100).toFixed(1)}%`;
    fill.style.backgroundColor = s < 0.6 ? 'var(--ok)' : s < 0.85 ? 'var(--warn)' : 'var(--bad)';
    tension.classList.toggle('danger', d.stress >= 1);
    this.$('.wear').hidden = d.wear < 0.02;
    this.$('.wear-fill').style.width = `${(Math.min(1, d.wear) * 100).toFixed(1)}%`;
    const integ = this.$('.integrity');
    integ.hidden = d.integrity >= 99.5 && !d.crossingWith;
    this.$('[data-cross]').textContent = d.crossingWith ? `¡Cruzado con ${d.crossingWith}!` : 'Hilo';
    this.$('.int-fill').style.width = `${d.integrity.toFixed(1)}%`;
    integ.classList.toggle('hot', !!d.crossingWith);

    this.$('[data-wind]').textContent = (d.windSpeed * 3.6).toFixed(0);
    this.$('.arrow').style.transform = `rotate(${d.windScreenAngle}rad)`;

    const fallen = this.$('.fallen');
    fallen.hidden = !d.fallen;
    if (d.fallen) {
      this.$('[data-fdist]').textContent = d.fallen.dist.toFixed(0);
      this.$('.fallen-arrow').style.transform = `rotate(${d.fallen.angle}rad)`;
    }
    this.$('.launch-btn').hidden = d.flying;

    for (const t of Array.from(this.$('.toasts').children) as HTMLElement[]) {
      const left = Number(t.dataset.left) - dt;
      t.dataset.left = String(left);
      if (left < 0.4) t.style.opacity = String(Math.max(0, left / 0.4));
      if (left <= 0) t.remove();
    }
  }

  showMessage(text: string, action: string, onAction: () => void) {
    this.$('[data-msg]').textContent = text;
    this.$('[data-action]').textContent = action;
    this.onAction = () => {
      this.hideMessage();
      onAction();
    };
    this.$('.message').hidden = false;
  }

  hideMessage() {
    this.$('.message').hidden = true;
    this.onAction = null;
  }

  /** Aviso corto; se apilan hasta 4. */
  toast(text: string, seconds = 3, kind: 'info' | 'good' | 'bad' | 'gold' = 'info') {
    const box = this.$('.toasts');
    const t = document.createElement('div');
    t.className = `panel toast ${kind}`;
    t.textContent = text;
    t.dataset.left = String(seconds);
    box.appendChild(t);
    while (box.children.length > 4) box.firstElementChild!.remove();
  }
}
