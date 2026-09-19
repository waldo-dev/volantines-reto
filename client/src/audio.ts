/**
 * Sonido del juego, sintetizado con WebAudio (sin archivos): viento, zumbido del hilo según la tensión,
 * raspado al cruzarse y efectos cortos (tirón, largada, crítico, corte, combo, captura).
 * El navegador solo deja sonar después de un gesto del usuario: `unlock()` se llama en el primer toque o tecla.
 */

const MUTE_KEY = 'volantines.muted';

export interface AudioFrame {
  windSpeed: number; // m/s
  altitude: number; // m
  flying: boolean;
  tension: number; // 0..1
  crossing: boolean;
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class GameAudio {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private humOsc!: OscillatorNode;
  private humFilter!: BiquadFilterNode;
  private humGain!: GainNode;
  private scrapeGain!: GainNode;

  constructor() {
    const unlock = () => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // sin almacenamiento solo no se recuerda
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && document.visibilityState === 'visible') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // Ruido blanco de 2 s para viento, raspado y golpes
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Viento: ruido con filtro pasa bajos que se abre con la velocidad
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Zumbido del hilo: sierra suave filtrada; sube de tono con la tensión
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sawtooth';
    this.humOsc.frequency.value = 110;
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'bandpass';
    this.humFilter.Q.value = 6;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humOsc.connect(this.humFilter).connect(this.humGain).connect(this.master);
    this.humOsc.start();

    // Raspado de hilos cruzados: ruido agudo
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = 'bandpass';
    scrapeFilter.frequency.value = 3800;
    scrapeFilter.Q.value = 2.5;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.loopNoise().connect(scrapeFilter).connect(this.scrapeGain).connect(this.master);
  }

  private loopNoise() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start();
    return src;
  }

  /** Sonidos continuos: se llama una vez por cuadro. */
  update(f: AudioFrame) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const w = Math.min(1.5, f.windSpeed / 8) * (0.6 + 0.4 * Math.min(1, f.altitude / 40));
    this.windGain.gain.setTargetAtTime(0.05 + 0.1 * w, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(250 + 500 * w, t, 0.3);
    const tension = f.flying ? f.tension : 0;
    this.humOsc.frequency.setTargetAtTime(80 + 220 * tension, t, 0.08);
    this.humFilter.frequency.setTargetAtTime(240 + 700 * tension, t, 0.08);
    this.humGain.gain.setTargetAtTime(f.flying ? 0.012 + 0.05 * tension * tension : 0, t, 0.1);
    this.scrapeGain.gain.setTargetAtTime(f.crossing ? 0.05 + Math.random() * 0.07 : 0, t, 0.03);
  }

  // --- Efectos cortos ---

  private ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted ? this.ctx : null;
  }

  /** Ráfaga de ruido filtrado con barrido de frecuencia. */
  private swish(from: number, to: number, dur: number, vol: number, q = 1.5, type: BiquadFilterType = 'bandpass', at = 0) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Nota con envolvente de golpe. */
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'triangle', at = 0, glideTo?: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  tiron() {
    this.swish(700, 3200, 0.14, 0.35, 2);
  }

  /** Tijeretazo: la cola se va volando. */
  tail() {
    this.swish(5000, 9000, 0.06, 0.35, 3);
    this.swish(4000, 7000, 0.06, 0.3, 3, 'bandpass', 0.09);
  }

  largada() {
    this.swish(2400, 400, 0.35, 0.25, 1.2);
  }

  crit() {
    this.tone(880, 0.35, 0.18, 'square');
    this.tone(1320, 0.5, 0.12, 'triangle', 0.01);
    this.swish(6000, 2500, 0.12, 0.3, 1, 'highpass');
  }

  /** Cortaste a alguien: chasquido del hilo y la gente que celebra. */
  cut() {
    this.swish(8000, 3000, 0.08, 0.5, 0.8, 'highpass');
    this.tone(620, 0.3, 0.2, 'sine', 0, 110);
    this.cheer(0.12);
  }

  /** Te cortaron. */
  cutBy() {
    this.swish(8000, 3000, 0.08, 0.4, 0.8, 'highpass');
    this.tone(330, 0.25, 0.14, 'triangle', 0.05);
    this.tone(220, 0.5, 0.14, 'triangle', 0.3);
  }

  /** Corte ajeno: solo un chasquido lejano. */
  cutFar() {
    this.swish(6000, 2500, 0.07, 0.12, 0.8, 'highpass');
  }

  /** Arpegio que crece con el largo del combo. */
  combo(n: number) {
    const notes = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760];
    for (let i = 0; i < Math.min(n, notes.length); i++) this.tone(notes[i], 0.22, 0.12, 'triangle', 0.25 + i * 0.07);
  }

  streak() {
    for (let i = 0; i < 6; i++) this.tone(660 * Math.pow(1.19, i), 0.3, 0.08, 'square', 0.6 + i * 0.05);
    this.cheer(0.18, 0.6);
  }

  /** Charchazo: palmada seca con un golpe grave abajo. */
  slap() {
    this.swish(3500, 1200, 0.07, 0.55, 1.5, 'bandpass');
    this.tone(140, 0.18, 0.35, 'sine', 0, 60);
  }

  capture() {
    this.tone(660, 0.12, 0.15, 'triangle');
    this.tone(990, 0.2, 0.15, 'triangle', 0.1);
  }

  /** Grito de la gente: ruido de banda media que sube y baja. */
  private cheer(vol: number, at = 0.05) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.25);
    g.gain.setTargetAtTime(0.0001, t + 0.6, 0.35);
    // Temblor irregular, como muchas voces
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    lfo.start(t);
    src.stop(t + 2.2);
    lfo.stop(t + 2.2);
  }
}
