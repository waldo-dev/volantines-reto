import type { NetPlayerInfo, RtcSignal } from '@volantines/shared';
import type { Online } from './online';

/**
 * Voz entre jugadores de una sala privada (WebRTC). El audio viaja directo entre navegadores; el servidor solo
 * reenvía las señales para que se encuentren. Se habla apretando un botón (o la tecla V) y cada voz sale desde
 * el personaje que habla: se oye más fuerte cerca y hacia su lado, pero nunca se apaga del todo.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** Distancias (m) del audio por cercanía: a menos de REF se oye completo; lejos baja hasta el mínimo. */
const PANNER = { ref: 8, max: 160, rolloff: 0.75 };
/** Nivel (0..1) desde el que se considera que alguien está hablando. */
const SPEAKING_LEVEL = 0.02;

interface V3 {
  x: number;
  y: number;
  z: number;
}

interface Peer {
  pc: RTCPeerConnection;
  /** El de id menor inicia la conexión (así nunca se cruzan dos ofertas). */
  initiator: boolean;
  pendingIce: RTCIceCandidateInit[];
  el: HTMLAudioElement | null;
  gain: GainNode | null;
  panner: PannerNode | null;
  analyser: AnalyserNode | null;
  retried: boolean;
}

export class Voice {
  /** La voz está activada en esta sala. */
  active = false;
  /** Estoy apretando para hablar. */
  talking = false;
  /** Jugadores que silencié (se mantiene mientras dure la página). */
  readonly muted = new Set<string>();
  /** Quiénes están hablando ahora (incluido yo). */
  readonly speaking = new Set<string>();
  /** Se llama cuando cambia algo que muestra la interfaz. */
  onChange: (() => void) | null = null;

  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private peers = new Map<string, Peer>();
  private buf = new Float32Array(256);

  constructor(private online: Online) {}

  /** Pide el micrófono y entra al canal de voz de la sala. Lanza un error con un mensaje para mostrar. */
  async enable() {
    if (this.active) return;
    if (!this.online.connected || !this.online.isPrivate) throw new Error('La voz es solo para salas privadas.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar el micrófono (se necesita HTTPS).');
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      throw new Error('No se pudo usar el micrófono. Revisa el permiso del navegador.');
    }
    // Pudo haberse salido de la sala mientras aceptaba el permiso
    if (!this.online.connected || !this.online.isPrivate) {
      this.stopMic();
      return;
    }
    for (const t of this.mic.getAudioTracks()) t.enabled = false;
    this.ctx = new AudioContext();
    void this.ctx.resume();
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 256;
    this.ctx.createMediaStreamSource(this.mic).connect(this.micAnalyser);
    this.active = true;
    this.online.send({ t: 'voice', on: true });
    this.sync(this.online.info);
    this.onChange?.();
  }

  /** Sale del canal de voz: corta las conexiones y apaga el micrófono. */
  disable(notify = true) {
    if (!this.active) return;
    this.active = false;
    this.talking = false;
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.stopMic();
    void this.ctx?.close();
    this.ctx = null;
    this.micAnalyser = null;
    this.speaking.clear();
    if (notify) this.online.send({ t: 'voice', on: false });
    this.onChange?.();
  }

  /** Apretar o soltar el botón para hablar. */
  setTalking(on: boolean) {
    if (!this.active || this.talking === on) return;
    this.talking = on;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = on;
    this.onChange?.();
  }

  toggleMute(id: string) {
    if (this.muted.has(id)) this.muted.delete(id);
    else this.muted.add(id);
    const p = this.peers.get(id);
    if (p?.gain) p.gain.gain.value = this.muted.has(id) ? 0 : 1;
    this.onChange?.();
  }

  /** Otros jugadores con la voz activada (para la lista de la interfaz). */
  members(): { id: string; name: string; connected: boolean }[] {
    const out: { id: string; name: string; connected: boolean }[] = [];
    for (const i of this.online.info.values()) {
      if (i.bot || !i.voice || i.id === this.online.myId) continue;
      const st = this.peers.get(i.id)?.pc.connectionState;
      out.push({ id: i.id, name: i.name, connected: st === 'connected' });
    }
    return out;
  }

  /** Con la lista nueva de la sala: conecta con quien activó la voz y suelta a quien la apagó o se fue. */
  sync(info: Map<string, NetPlayerInfo>) {
    if (!this.active) return;
    const want = new Set<string>();
    for (const i of info.values()) if (!i.bot && i.voice && i.id !== this.online.myId) want.add(i.id);
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.dropPeer(id);
    for (const id of want) if (!this.peers.has(id)) this.createPeer(id);
    this.onChange?.();
  }

  /** Señal de WebRTC que reenvió el servidor. */
  async handleSignal(from: string, d: RtcSignal) {
    if (!this.active) return;
    const peer = this.peers.get(from) ?? this.createPeer(from);
    const pc = peer.pc;
    try {
      if (d.sdp) {
        // Solo el que no inicia recibe ofertas; si llega una igual se respeta (puede ser un reintento)
        if (d.sdp.type === 'offer' && pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          const local = pc.localDescription;
          if (local) this.signal(from, { sdp: { type: 'answer', sdp: local.sdp } });
        }
        for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (d.ice) {
        if (pc.remoteDescription) await pc.addIceCandidate(d.ice).catch(() => {});
        else peer.pendingIce.push(d.ice);
      }
    } catch {
      // Una señal fuera de orden no debe botar el juego; si la conexión falla se reintenta una vez
    }
  }

  /**
   * Cada cuadro: el oído va en tu personaje mirando hacia donde mira la cámara, y cada voz sale del suyo.
   * `positions` trae dónde está cada jugador.
   */
  update(listener: V3, forward: V3, positions: (id: string) => V3 | null) {
    if (!this.active || !this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.x, t, 0.05);
      L.positionY.setTargetAtTime(listener.y + 1.6, t, 0.05);
      L.positionZ.setTargetAtTime(listener.z, t, 0.05);
      L.forwardX.setTargetAtTime(forward.x, t, 0.05);
      L.forwardY.setTargetAtTime(forward.y, t, 0.05);
      L.forwardZ.setTargetAtTime(forward.z, t, 0.05);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      // Firefox antiguo
      L.setPosition(listener.x, listener.y + 1.6, listener.z);
      L.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }

    let changed = false;
    const mark = (id: string, on: boolean) => {
      if (on === this.speaking.has(id)) return;
      if (on) this.speaking.add(id);
      else this.speaking.delete(id);
      changed = true;
    };
    for (const [id, p] of this.peers) {
      const pos = positions(id);
      if (p.panner && pos) {
        p.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
        p.panner.positionY.setTargetAtTime(pos.y + 1.6, t, 0.05);
        p.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
      }
      mark(id, !this.muted.has(id) && !!p.analyser && this.level(p.analyser) > SPEAKING_LEVEL);
    }
    mark(this.online.myId, this.talking && !!this.micAnalyser && this.level(this.micAnalyser) > SPEAKING_LEVEL);
    if (changed) this.onChange?.();
  }

  private level(a: AnalyserNode) {
    a.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  private signal(to: string, d: RtcSignal) {
    this.online.send({ t: 'rtc', to, d });
  }

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, initiator: this.online.myId < id, pendingIce: [], el: null, gain: null, panner: null, analyser: null, retried: false };
    this.peers.set(id, peer);
    for (const t of this.mic?.getAudioTracks() ?? []) pc.addTrack(t, this.mic!);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(id, { ice: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } });
    };
    pc.ontrack = (e) => this.attachAudio(peer, e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      this.onChange?.();
      if (pc.connectionState !== 'failed' || this.peers.get(id) !== peer) return;
      // El que no inicia suelta la conexión rota y espera la oferta nueva
      if (!peer.initiator) return this.dropPeer(id);
      // Un reintento si falla (por ejemplo, al cambiar de wifi a datos)
      if (!peer.retried) {
        peer.retried = true;
        this.dropPeer(id);
        setTimeout(() => {
          if (this.active && !this.peers.has(id) && this.online.info.get(id)?.voice) this.createPeer(id).retried = true;
        }, 1500);
      }
    };
    if (peer.initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          const local = pc.localDescription;
          if (local) this.signal(id, { sdp: { type: 'offer', sdp: local.sdp } });
        } catch {
          // Se reintenta con el siguiente cambio de la sala
        }
      };
    }
    return peer;
  }

  private attachAudio(peer: Peer, stream: MediaStream) {
    if (!this.ctx || peer.panner) return;
    // Chrome no entrega el audio remoto a Web Audio si el stream no está también en un elemento de audio
    peer.el = new Audio();
    peer.el.muted = true;
    peer.el.srcObject = stream;
    void peer.el.play().catch(() => {});

    const src = this.ctx.createMediaStreamSource(stream);
    peer.analyser = this.ctx.createAnalyser();
    peer.analyser.fftSize = 256;
    peer.gain = this.ctx.createGain();
    peer.gain.gain.value = 1;
    peer.panner = new PannerNode(this.ctx, {
      panningModel: 'equalpower',
      distanceModel: 'linear',
      refDistance: PANNER.ref,
      maxDistance: PANNER.max,
      rolloffFactor: PANNER.rolloff,
    });
    src.connect(peer.analyser);
    src.connect(peer.gain).connect(peer.panner).connect(this.ctx.destination);
    const id = [...this.peers].find(([, p]) => p === peer)?.[0];
    if (id && this.muted.has(id)) peer.gain.gain.value = 0;
    this.onChange?.();
  }

  private dropPeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.panner?.disconnect();
    p.gain?.disconnect();
    if (p.el) p.el.srcObject = null;
    this.speaking.delete(id);
  }

  private stopMic() {
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
  }
}
