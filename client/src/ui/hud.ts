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
  /** s que quedan de racha "¡Encachado!" (null sin racha). */
  streak: number | null;
  /** Volantines en la mochila y cuántos caben. */
  bag: { n: number; cap: number };
  /** Tu casa (solo si llevas volantines y estás lejos): distancia y ángulo en pantalla. */
  home: { dist: number; angle: number } | null;
  /** Recién cruzado: es el momento del golpe crítico. */
  critMoment: boolean;
  /** Tu volantín está dentro de la zona de bono del mapa. */
  inBonus: boolean;
  /** Tu hilo está tocando un cable del tendido. */
  onCable: boolean;
}

/** Panel de voz (solo en salas privadas). */
export interface HudVoice {
  active: boolean;
  talking: boolean;
  meSpeaking: boolean;
  touch: boolean;
  members: { id: string; name: string; connected: boolean; muted: boolean; speaking: boolean }[];
}

export type AnnounceKind = 'cut' | 'crit' | 'combo' | 'streak' | 'bad';

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
        <div class="bag-stat"><span class="label">Mochila</span><b data-bag>0</b> / <span data-bagcap>2</span></div>
      </div>
      <button class="panel menu-btn">🎨 Personalizar</button>
      <button class="panel fs-btn" hidden title="Pantalla completa">⛶</button>
      <div class="panel tension">
        <span class="label">Tensión del hilo</span><div class="bar"><div class="fill"></div></div>
        <div class="wear" hidden><span class="label">Desgaste</span><div class="bar"><div class="wear-fill"></div></div></div>
        <div class="integrity" hidden><span class="label" data-cross>Cruzado</span><div class="bar"><div class="int-fill"></div></div></div>
        <div class="streak-badge" hidden>🔥 ¡ENCACHADO! <b data-streak>0</b>s</div>
        <div class="bonus-chip" hidden>✨ ZONA BONUS · cortar aquí paga más</div>
        <div class="cable-chip" hidden>⚡ ¡Enredado en el cable! Suelta o sube</div>
      </div>
      <div class="panel wind"><div class="vane"><div class="arrow">↑</div></div><div><span class="label">Viento</span><b data-wind>0</b> km/h</div><button class="snd-btn" title="Sonido">🔊</button></div>
      <div class="feed"></div>
      <div class="announce"></div>
      <div class="crit-hint" hidden>⚡ ¡AHORA! <span data-crit-keys></span></div>
      <div class="hit-hint" hidden></div>
      <div class="panel room-chip" hidden></div>
      <div class="panel voice-panel" hidden>
        <button class="voice-toggle">🎙️ Activar voz</button>
        <button class="ptt-btn" hidden>🎙️ Mantén para hablar</button>
        <div class="voice-list"></div>
      </div>
      <div class="bottom-stack">
        <button class="panel launch-btn" hidden>🪁 Encumbrar</button>
        <div class="panel home-hint" hidden><span class="home-arrow">↑</span> 🏠 Tu casa a <b data-hdist>0</b> m · 🎒 <b data-hbag>0</b></div>
        <div class="panel fallen" hidden><span class="fallen-arrow">↑</span> Volantín caído a <b data-fdist>0</b> m</div>
      </div>
      <div class="panel message" hidden><div data-msg></div><button data-action></button></div>
      <div class="toasts"></div>
      <div class="panel help">
        <kbd>W A S D</kbd> caminar · <kbd>Clic izq.</kbd>/<kbd>Espacio</kbd> tirar · <kbd>Clic der.</kbd>/<kbd>Shift</kbd> soltar ·
        <kbd>Mouse</kbd>/<kbd>Q E</kbd> dirigir · <kbd>Rueda</kbd> zoom · <kbd>R</kbd> encumbrar · <kbd>M</kbd> menú · <kbd>G</kbd> ajustes<br />
        <kbd>F</kbd>/<kbd>Clic medio</kbd> tirón seco · <kbd>Shift</kbd> ×2 (o <kbd>C</kbd>) largada: úsalos justo al cruzarte para un golpe crítico.<br />
        Tira cuando la punta apunte hacia arriba. Recoge todo el hilo para guardar el volantín y salir a buscar los caídos.<br />
        A pie, <kbd>Clic izq.</kbd>/<kbd>Espacio</kbd> junto a alguien: charchazo 👋 (si le pegas a quien te cortó, es venganza).
      </div>
    `;
    this.$ = (sel: string) => root.querySelector(sel) as HTMLElement;
    this.$('[data-action]').addEventListener('click', () => this.onAction?.());
    this.$('.menu-btn').addEventListener('click', () => this.onMenu?.());
    this.$('.launch-btn').addEventListener('click', () => this.onLaunch?.());
    this.$('.fs-btn').addEventListener('click', () => this.onFullscreen?.());
    this.$('.snd-btn').addEventListener('click', () => this.onSound?.());
    this.$('.voice-toggle').addEventListener('click', () => this.onVoiceToggle?.());
    // Apretar para hablar: mientras el dedo o el clic esté abajo
    const ptt = this.$('.ptt-btn');
    ptt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ptt.setPointerCapture(e.pointerId);
      this.onTalk?.(true);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) ptt.addEventListener(ev, () => this.onTalk?.(false));
    ptt.addEventListener('contextmenu', (e) => e.preventDefault());
    this.$('.voice-list').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-mute]')?.dataset.mute;
      if (id) this.onVoiceMute?.(id);
    });
  }

  onVoiceToggle: (() => void) | null = null;
  onTalk: ((on: boolean) => void) | null = null;
  onVoiceMute: ((id: string) => void) | null = null;

  /** Muestra el panel de voz (null lo esconde: modo solo o sala pública). */
  setVoice(v: HudVoice | null) {
    const panel = this.$('.voice-panel');
    panel.hidden = !v;
    if (!v) return;
    const toggle = this.$('.voice-toggle');
    toggle.textContent = v.active ? '🎙️ Voz activada · apagar' : '🎙️ Activar voz';
    toggle.classList.toggle('on', v.active);
    const ptt = this.$('.ptt-btn');
    ptt.hidden = !v.active;
    ptt.classList.toggle('talking', v.talking);
    ptt.textContent = v.talking ? (v.meSpeaking ? '🔴 Hablando…' : '🔴 Te escuchan') : v.touch ? '🎙️ Mantén para hablar' : '🎙️ Mantén V para hablar';
    const list = this.$('.voice-list');
    list.replaceChildren(
      ...(!v.active
        ? []
        : v.members.length === 0
          ? [Object.assign(document.createElement('div'), { className: 'voice-empty', textContent: 'Nadie más tiene la voz activada' })]
          : v.members.map((m) => {
              const row = document.createElement('div');
              row.className = `voice-member${m.speaking ? ' speaking' : ''}`;
              const name = document.createElement('span');
              name.textContent = `${m.speaking ? '🔊' : m.connected ? '🟢' : '⏳'} ${m.name}`;
              const btn = document.createElement('button');
              btn.dataset.mute = m.id;
              btn.title = m.muted ? 'Volver a escuchar' : 'Silenciar';
              btn.textContent = m.muted ? '🔇' : '🔈';
              row.append(name, btn);
              return row;
            })),
    );
  }

  onSound: (() => void) | null = null;

  setSound(on: boolean) {
    this.$('.snd-btn').textContent = on ? '🔊' : '🔇';
  }

  /** Texto grande en el centro que aparece con un golpe ("¡CORTASTE!", "¡DOBLE!", "¡CRÍTICO!"). */
  announce(text: string, kind: AnnounceKind, sub = '') {
    const box = this.$('.announce');
    const el = document.createElement('div');
    el.className = `ann ${kind}`;
    el.innerHTML = `<b></b>${sub ? '<small></small>' : ''}`;
    el.querySelector('b')!.textContent = text;
    if (sub) el.querySelector('small')!.textContent = sub;
    el.dataset.left = '1.8';
    box.appendChild(el);
    while (box.children.length > 2) box.firstElementChild!.remove();
  }

  /** Línea en la lista de cortes (arriba a la derecha). */
  feed(html: string) {
    const box = this.$('.feed');
    const el = document.createElement('div');
    el.className = 'panel feed-line';
    el.innerHTML = html;
    el.dataset.left = '7';
    box.prepend(el);
    while (box.children.length > 4) box.lastElementChild!.remove();
  }

  onFullscreen: (() => void) | null = null;

  /** Aviso de que tienes a alguien al alcance de un charchazo (null lo esconde). */
  setHitHint(name: string | null, touch: boolean) {
    const el = this.$('.hit-hint');
    el.hidden = !name;
    if (name) el.textContent = `👋 ${touch ? 'TIRAR' : 'Clic / Espacio'}: charchazo a ${name}`;
  }

  /** Indicador de sala online (null en modo solo). */
  setRoom(text: string | null) {
    const el = this.$('.room-chip');
    el.hidden = !text;
    el.textContent = text ? `🌐 ${text}` : '';
  }

  setTouch(isTouch: boolean) {
    this.$('.help').hidden = isTouch;
    this.$('[data-crit-keys]').textContent = isTouch ? 'Pega un TIRÓN' : 'Tirón (F) o largada (Shift ×2)';
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

    this.$('[data-bag]').textContent = String(d.bag.n);
    this.$('[data-bagcap]').textContent = String(d.bag.cap);
    this.$('.bag-stat').classList.toggle('full', d.bag.n >= d.bag.cap);
    const home = this.$('.home-hint');
    home.hidden = !d.home;
    if (d.home) {
      this.$('[data-hdist]').textContent = d.home.dist.toFixed(0);
      this.$('[data-hbag]').textContent = `${d.bag.n}/${d.bag.cap}`;
      this.$('.home-arrow').style.transform = `rotate(${d.home.angle}rad)`;
    }

    const badge = this.$('.streak-badge');
    badge.hidden = d.streak === null;
    if (d.streak !== null) this.$('[data-streak]').textContent = Math.ceil(d.streak).toString();
    this.$('.crit-hint').hidden = !d.critMoment;
    this.$('.bonus-chip').hidden = !d.inBonus;
    this.$('.cable-chip').hidden = !d.onCable;

    for (const t of [...this.$('.feed').children, ...this.$('.announce').children] as HTMLElement[]) {
      const left = Number(t.dataset.left) - dt;
      t.dataset.left = String(left);
      if (left < 0.5) t.style.opacity = String(Math.max(0, left / 0.5));
      if (left <= 0) t.remove();
    }

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
