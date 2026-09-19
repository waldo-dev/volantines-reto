import * as THREE from 'three';
import {
  BRAWL,
  COMBO,
  RevengeBook,
  brawlTarget,
  knockDir,
  CUT,
  DELIVERY_RADIUS,
  DROP_LOCK,
  KITES,
  REWARDS,
  activeMap,
  bagOf,
  cableSegments,
  captureValue,
  inBonus,
  isMapId,
  mapById,
  useMap,
  walkable,
  poleOf,
  trophyOf,
  NET_RATE,
  comboName,
  groundHeight,
  isUpset,
  newCombo,
  registerCut,
  resetCombo,
  resolveCables,
  resolveCrossings,
  resolveTailCuts,
  streakActive,
  windAt,
  type BotView,
  type CarryItem,
  type ComboState,
  type Hook,
  type KiteInput,
  type LineBody,
  type ManeuverKind,
  type MapId,
  type NetPlayerInfo,
  type V3,
} from '@volantines/shared';
import './style.css';
import { Input } from './input';
import { CameraRig } from './cameraRig';
import { createWorld } from './scene/world';
import { Hud } from './ui/hud';
import { Menu, type MenuChange } from './ui/menu';
import { createDebugPanel } from './ui/debug';
import { loadoutFrom } from './profile';
import { Session } from './session';
import { Flyer } from './game/flyer';
import { FallenKites } from './game/fallen';
import { createBots, updateBot } from './game/bots';
import { Sparks } from './game/sparks';
import { Online } from './net/online';
import { Voice } from './net/voice';
import { GameAudio } from './audio';
import { HomeMarker } from './entities/homeMarker';
import { Telemetry } from './telemetry';
import { loadGraphics, preset, saveGraphics, type Graphics } from './graphics';

const FIXED_DT = 1 / 120;
const WALK_WITH_KITE = 3.5;
const RUN_FREE = 6;
const REPORT_EVERY = 15;

// --- Sin zoom en móvil: iOS ignora user-scalable=no, así que se bloquean los gestos a mano ---
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    // `scale` solo existe en iOS; en Android el pellizco ya lo frena user-scalable=no
    const scale = (e as TouchEvent & { scale?: number }).scale;
    if (scale !== undefined && scale !== 1) e.preventDefault();
  },
  { passive: false },
);

// --- Render ---
const canvas = document.getElementById('game') as HTMLCanvasElement;
const isMobile = window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
// Calidad elegida en el menú (Automática por defecto) y tope de FPS
let graphics = loadGraphics();
let gfx = preset(graphics.quality, isMobile);
let pixelRatio = gfx.pixelRatio;
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = gfx.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 3000);
// Escenario: el último elegido o El Cerro (en desarrollo también ?mapa=playa en la URL)
const MAP_KEY = 'volantines.map';
const savedMap = (() => {
  try {
    const fromUrl = import.meta.env.DEV ? new URLSearchParams(location.search).get('mapa') : null;
    return fromUrl ?? localStorage.getItem(MAP_KEY);
  } catch {
    return null;
  }
})();
useMap(isMapId(savedMap) ? savedMap : 'cerro');
let quality = { shadows: gfx.shadows, mobile: isMobile, density: gfx.density };
let world = createWorld(scene, quality, activeMap());
/** Tramos de cable del mapa (física de los cables del tendido). */
let cables = cableSegments(activeMap(), groundHeight);
if (import.meta.env.DEV) Object.assign(window, { __game: { renderer, scene, camera } });
const rig = new CameraRig(camera);

let rotateDismissed = false;
const rotateEl = document.getElementById('rotate')!;
rotateEl.addEventListener('pointerdown', () => {
  rotateDismissed = true;
  rotateEl.hidden = true;
});

// --- Sesión, entrada e interfaz ---
const session = new Session();
const telemetry = new Telemetry(() => session.token);
telemetry.track('session_start', { mobile: isMobile, map: activeMap().id });
session.onBuy = (item) => telemetry.track('buy', { item });
const input = new Input(canvas, document.getElementById('touch')!);
const hud = new Hud(document.getElementById('hud')!);
hud.setTouch(input.isTouch);

/** Evita que el volantín quede tapado por los paneles del HUD (tensión, viento, etc.) al ir muy alto. */
function updateHudMargin() {
  let maxBottom = 0;
  for (const sel of ['.player-card', '.stats', '.tension', '.wind']) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
  }
  const fraction = Math.min(0.4, maxBottom / window.innerHeight);
  rig.topMargin = THREE.MathUtils.degToRad(camera.fov) * fraction;
}

function resize() {
  // Tamaño real del canvas en pantalla: en el celular la barra del navegador cambia el alto visible
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (input.isTouch && h > w && !rotateDismissed) rotateEl.hidden = false;
  if (w > h) rotateEl.hidden = true;
  updateHudMargin();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
// Al girar el teléfono el tamaño final llega un poco después
window.addEventListener('orientationchange', () => setTimeout(resize, 300));
resize();

/** Pantalla completa y horizontal en celulares (Android; en iPhone se usa "Agregar a inicio"). */
function goFullscreen() {
  if (!input.isTouch || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => undefined);
}
hud.onFullscreen = goFullscreen;
document.addEventListener('fullscreenchange', () => setTimeout(resize, 200));

// --- Jugadores: tú y los bots ---
const ropePoints = isMobile ? 14 : 18;
const player = new Flyer(
  scene,
  {
    id: 'yo',
    name: session.data.name,
    isBot: false,
    look: session.data.look,
    design: session.data.design,
    loadout: loadoutFrom(session.data.gear),
    shadows: !isMobile,
    ropePoints,
    tagColor: '#ffd84a',
  },
  { x: 0, y: 0, z: 0 },
);
const rand = Math.random;
const botCount = isMobile ? 2 : 3;
let bots = createBots(scene, botCount, !isMobile, ropePoints, rand);
let flyers = [player, ...bots];

// --- Modo online ---
const online = new Online();
let mode: 'solo' | 'online' = 'solo';
const remotes = new Map<string, Flyer>();
let sendTimer = 0;
const fallen = new FallenKites(scene);
const sparks = new Sparks(scene);
const audio = new GameAudio();
hud.setSound(!audio.muted);

// --- Voz (solo en salas privadas, para jugar entre conocidos) ---
const voice = new Voice(online);
/** El botón "mantén para hablar" está apretado. */
let pttHeld = false;
online.onSignal = (from, d) => void voice.handleSignal(from, d);
function refreshVoice() {
  if (mode !== 'online' || !online.connected || !online.isPrivate) return hud.setVoice(null);
  hud.setVoice({
    active: voice.active,
    talking: voice.talking,
    meSpeaking: voice.speaking.has(online.myId),
    touch: input.isTouch,
    members: voice.members().map((m) => ({ ...m, muted: voice.muted.has(m.id), speaking: voice.speaking.has(m.id) })),
  });
}
voice.onChange = refreshVoice;
hud.onVoiceToggle = async () => {
  if (voice.active) return voice.disable();
  try {
    await voice.enable();
    hud.toast(input.isTouch ? 'Voz activada: mantén el botón para hablar' : 'Voz activada: mantén V para hablar', 3);
  } catch (err) {
    hud.toast((err as Error).message, 5, 'bad');
  }
};
hud.onTalk = (on) => {
  pttHeld = on;
};
hud.onVoiceMute = (id) => voice.toggleMute(id);
const camDir = new THREE.Vector3();

hud.onSound = () => {
  audio.setMuted(!audio.muted);
  hud.setSound(!audio.muted);
};

/** Combos y rachas de cada uno (en modo solo; online el servidor manda y aquí solo se sigue el tuyo). */
const combos = new Map<string, ComboState>();
function comboOf(id: string) {
  let c = combos.get(id);
  if (!c) combos.set(id, (c = newCombo()));
  return c;
}
/** s reales que quedan de cámara lenta (al cortar, solo en modo solo). */
let slowmo = 0;
/** Hasta cuándo (reloj real, s) se muestra el aviso del golpe crítico tras cruzarte. */
let critMomentUntil = 0;
let wasCrossing = false;
const CRIT_TIP_KEY = 'volantines.critTip';

// --- Mochila y casa (fase 3) ---
/** Volantines capturados que llevas: se cobran al llegar a tu casa (en online el servidor lleva la cuenta y aquí se sigue). */
const bag: CarryItem[] = [];
const homeMarker = new HomeMarker(scene);
homeMarker.setPosition(player.home);
const myBag = () => bagOf(session.data.gear.bag);
const myPole = () => poleOf(session.data.gear.pole);
let bagFullToast = 0;

/**
 * En una sala online con cuenta, los cortes, críticos, colas y entregas los acredita el servidor (lo que vio él):
 * el cliente no los suma, para que no se cuenten dos veces ni se puedan inventar.
 */
const serverCredits = () => mode === 'online' && !session.isGuest;

/** Llegaste a tu casa con la mochila cargada: se cobran y van al álbum. */
function deliver(items: CarryItem[]) {
  bag.length = 0;
  if (!items.length) return;
  const pole = myPole();
  let coins = 0;
  for (const it of items) coins += captureValue(it.kite, pole);
  if (!serverCredits()) {
    for (const it of items) session.capture(trophyOf(it));
    session.add('captureBonus', coins - REWARDS.capture * items.length);
    session.add('bestDelivery', items.length);
  }
  telemetry.track('delivery', { n: items.length, coins });
  devLog('delivered', { n: items.length, coins });
  hud.announce(`¡ENTREGA! +${coins} 🪙`, 'combo', `${items.length} ${items.length === 1 ? 'volantín' : 'volantines'} al álbum`);
  audio.combo(Math.min(6, items.length + 1));
  player.character.playOnce('emote-yes');
  setTimeout(() => void session.flush(), 600);
}

/** Recogiste un volantín: a la mochila. */
function pickUp(item: CarryItem, own: boolean) {
  bag.push(item);
  const cap = myBag().capacidad;
  devLog('pickup', { n: bag.length, cap, own });
  audio.capture();
  player.character.playOnce('pick-up');
  hud.toast(
    `🎒 ${own ? '¡Recuperaste tu volantín!' : `¡Capturaste el volantín de ${item.ownerName}!`} (${bag.length}/${cap}) · llévalo a tu casa 🏠`,
    4,
    'good',
  );
}

let time = 0;
let stepCount = 0;
const contactsNow = new Set<string>();
const hooks = new Map<string, Hook>(); // pares de hilos enganchados
if (import.meta.env.DEV) Object.assign((window as unknown as { __game: object }).__game, { flyers, hooks, fallen });
let playerCrossing: string | null = null;
let wasStowed = false;
let fullLineCounted = false;
let reportTimer = REPORT_EVERY;

function applySession() {
  const d = session.data;
  player.setName(d.name, '#ffd84a');
  player.setLook(d.look);
  player.setDesign(d.design);
  player.setLoadout(loadoutFrom(d.gear));
  const lvl = session.level;
  hud.setPlayer({ name: d.name, level: lvl.level, xpInto: lvl.into, xpNeed: lvl.need, coins: d.coins, guest: session.isGuest });
  if (online.connected) online.send({ t: 'profile', name: d.name, look: d.look, design: d.design, gear: d.gear });
}
session.onChange = () => {
  applySession();
  menu.refresh();
};
session.onRewards = (r) => {
  if (r.levelUp) telemetry.track('level_up', { level: r.levelUp });
  if (r.coins > 0) hud.toast(`+${r.coins} 🪙`, 2.5, 'gold');
  for (const a of r.achievements) hud.toast(`🏆 Logro: ${a.nombre} (+${a.monedas} 🪙)`, 5, 'gold');
  if (r.levelUp) hud.toast(`⭐ ¡Subiste a nivel ${r.levelUp}!`, 5, 'gold');
};
applySession();
void session.restore();

function launchPlayer() {
  hud.hideMessage();
  const w = windAt(time, 5);
  player.launch(w.x, w.z);
  wasStowed = false;
  fullLineCounted = false;
}
launchPlayer();
rig.snap(player.pos, player.kite!.pos);

/** Pone al jugador en un punto del cerro y le da un volantín nuevo. */
function respawn(x: number, z: number) {
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = groundHeight(x, z);
  // Donde apareces queda tu casa (y se vacía la mochila)
  player.home.x = x;
  player.home.y = player.pos.y;
  player.home.z = z;
  homeMarker.setPosition(player.home);
  bag.length = 0;
  player.vel.x = player.vel.z = 0;
  player.character.update(player.pos, 0, null, 0, 0);
  launchPlayer();
  rig.snap(player.pos, player.kite!.pos);
}

/** Crea, actualiza o saca a los demás jugadores según la lista de la sala. */
function syncRemotes(info: Map<string, NetPlayerInfo>) {
  for (const [id, r] of remotes) {
    if (!info.has(id)) {
      r.dispose();
      remotes.delete(id);
    }
  }
  for (const i of info.values()) {
    if (i.id === online.myId) continue;
    const color = i.bot ? '#cfe3f4' : '#ffffff';
    let r = remotes.get(i.id);
    if (!r) {
      r = new Flyer(scene, { id: i.id, name: i.name, isBot: i.bot, look: i.look, design: i.design, loadout: loadoutFrom(i.gear), shadows: !isMobile, ropePoints, tagColor: color }, { x: 0, y: 0, z: 0 });
      r.fid = -1;
      remotes.set(i.id, r);
      continue;
    }
    if (r.name !== i.name) r.setName(i.name, color);
    if (JSON.stringify(r.design) !== JSON.stringify(i.design)) r.setDesign(i.design);
    r.setLoadout(loadoutFrom(i.gear));
    r.setLook(i.look);
  }
  flyers = [player, ...remotes.values()];
  voice.sync(info);
  refreshVoice();
  hud.setRoom(`${mapById(online.map).emoji} Sala ${online.room}${online.isPrivate ? ' (privada)' : ''} · ${[...info.values()].filter((p) => !p.bot).length} jugadores`);
}

/** Entra a una sala online: '' partida rápida, 'NUEVA' sala privada, o un código. */
async function goOnline(room: string) {
  // La voz es de una sala: al cambiar de sala se apaga
  voice.disable(false);
  pttHeld = false;
  const d = session.data;
  await online.connect(room, { name: d.name, look: d.look, design: d.design, gear: d.gear, token: session.token, map: chosenMap });
  mode = 'online';
  // La sala manda el escenario (al entrar con código puede ser otro)
  switchMap(online.map);
  telemetry.track('play', { mode: 'online', map: online.map, private: online.isPrivate });
  for (const b of bots) b.dispose();
  bots = [];
  fallen.clear();
  hooks.clear();
  combos.clear();
  syncRemotes(online.info);
  time = online.serverNow();
  respawn(online.spawn[0], online.spawn[2]);
}

/** Cambia de escenario: arma el mundo nuevo y (en modo solo) vuelve a empezar en el cerro del mapa. */
function switchMap(id: MapId) {
  if (id === activeMap().id) return;
  telemetry.track('map', { map: id });
  world.dispose();
  useMap(id);
  world = createWorld(scene, quality, activeMap());
  if (lowQuality) world.sun.castShadow = false;
  cables = cableSegments(activeMap(), groundHeight);
  fallen.clear();
  hooks.clear();
  combos.clear();
  hud.toast(`${activeMap().emoji} ${activeMap().nombre}: viento de ${Math.round(activeMap().wind.base * 3.6)} km/h`, 4);
  if (mode === 'solo') {
    for (const b of bots) b.dispose();
    bots = createBots(scene, botCount, !isMobile, ropePoints, rand);
    flyers = [player, ...bots];
    respawn(0, 0);
  }
}
/** Cambia la calidad o el tope de FPS: ajusta el render y rearma el paisaje con su nueva densidad. */
function setGraphics(g: Graphics) {
  const rebuild = g.quality !== graphics.quality;
  graphics = g;
  saveGraphics(g);
  if (!rebuild) return;
  gfx = preset(g.quality, isMobile);
  quality = { shadows: gfx.shadows, mobile: isMobile, density: gfx.density };
  lowQuality = false;
  pixelRatio = gfx.pixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = gfx.shadows;
  world.dispose();
  world = createWorld(scene, quality, activeMap());
  // Los materiales se recompilan con o sin sombras
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
  });
  resize();
}

/** Mapa elegido en el menú (para modo solo y para la próxima sala online). */
let chosenMap: MapId = activeMap().id;

/** Vuelve al modo solo con bots locales. */
function goSolo() {
  voice.disable(false);
  pttHeld = false;
  online.close();
  hud.setVoice(null);
  mode = 'solo';
  for (const r of remotes.values()) r.dispose();
  remotes.clear();
  fallen.clear();
  hooks.clear();
  combos.clear();
  if (chosenMap !== activeMap().id) {
    mode = 'solo';
    switchMap(chosenMap);
    hud.setRoom(null);
    return;
  }
  bots = createBots(scene, botCount, !isMobile, ropePoints, rand);
  flyers = [player, ...bots];
  hud.setRoom(null);
  respawn(0, 0);
}

const menu = new Menu(
  session,
  (what: MenuChange) => {
    if (what !== 'account') applySession();
  },
  () => {
    input.enabled = true;
    if (mode === 'solo') telemetry.track('play', { mode: 'solo', map: activeMap().id });
    goFullscreen();
    hud.toast(
      input.isTouch
        ? 'Mantén SOLTAR para darle hilo. TIRA cuando la punta apunte hacia arriba.'
        : 'Clic derecho (Shift) suelta hilo. Clic izquierdo (Espacio) tira: hazlo cuando la punta apunte hacia arriba.',
      6,
    );
    setTimeout(
      () =>
        hud.toast(
          input.isTouch
            ? '⚡ Justo al cruzarte con otro hilo pega un TIRÓN (o toca SOLTAR dos veces): ¡golpe crítico!'
            : '⚡ Justo al cruzarte con otro hilo pega un tirón (F) o una largada (Shift dos veces): ¡golpe crítico!',
          7,
        ),
      6500,
    );
  },
  {
    play: async (room) => {
      if (room === null) goSolo();
      else await goOnline(room);
    },
    status: () =>
      mode === 'online'
        ? { room: online.room, isPrivate: online.isPrivate, players: [...online.info.values()].map((p) => (p.bot ? `${p.name} (bot)` : p.name)) }
        : null,
    graphics: () => graphics,
    setGraphics,
    map: () => chosenMap,
    selectMap: (id) => {
      chosenMap = id;
      try {
        localStorage.setItem(MAP_KEY, id);
      } catch {
        // sin almacenamiento solo no se recuerda
      }
      if (mode === 'solo') switchMap(id);
      else hud.toast(`${mapById(id).nombre}: se usará en tu próxima sala.`, 4);
    },
  },
);
function openMenu() {
  input.enabled = false;
  menu.show();
}
hud.onMenu = openMenu;
hud.onLaunch = () => {
  if (!player.flying) launchPlayer();
};
openMenu();

// Guarda el progreso al salir o cambiar de pestaña
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void session.flush();
});

let debugOpen: { destroy(): void } | null = null;
async function toggleDebug() {
  if (debugOpen) {
    debugOpen.destroy();
    debugOpen = null;
    return;
  }
  debugOpen = await createDebugPanel(player.loadout, () => player.setLoadout(player.loadout));
}
if (new URLSearchParams(location.search).has('debug')) void toggleDebug();

const windFor = (alt: number) => windAt(time, alt);
const NO_KITE: KiteInput = { tirar: false, soltar: false, dirX: 0 };

/** En desarrollo deja registro de cortes y críticos en window.__game.log (para pruebas en el navegador). */
const gameLog: { t: string; at: number; [k: string]: unknown }[] = [];
function devLog(t: string, data: object) {
  if (import.meta.env.DEV) gameLog.push({ t, at: Math.round(time * 10) / 10, ...data });
}
if (import.meta.env.DEV) {
  const g = (window as unknown as { __game: object }).__game;
  Object.assign(g, { log: gameLog, player, hud, input, online, session, fallen });
  Object.defineProperty(g, 'mode', { get: () => mode });
  void import('@volantines/shared').then((m) => Object.assign(g, { shared: m, loadoutFrom }));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const who = (name: string, me: boolean) => (me ? '<span class="me">Tú</span>' : escapeHtml(name));
const maneuverName = (k: ManeuverKind) => (k === 2 ? 'LARGADA' : 'TIRÓN');

interface CutInfo {
  combo: number;
  upset: boolean;
  streak: boolean;
  /** Cortó con su volantín dentro de la zona de bono. */
  bonus: boolean;
  /** Se cortó enredado en los cables. */
  cable: boolean;
}
let playerOnCable = false;

/** Un corte (en solo o informado por el servidor): anuncios, sonido, lista de cortes y progreso. */
function onCut(victimName: string, victimMe: boolean, cutterName: string | null, cutterMe: boolean, info: CutInfo) {
  devLog('cut', { victimName, victimMe, cutterName, cutterMe, ...info });
  const tags = `${info.combo > 1 ? `<span class="tag">${comboName(info.combo)}</span>` : ''}${info.upset ? '<span class="tag">CONTRA LA CORRIENTE</span>' : ''}${info.bonus ? '<span class="tag">✨ ZONA BONUS</span>' : ''}`;
  hud.feed(
    cutterName
      ? `${who(cutterName, cutterMe)} ✂️ ${who(victimName, victimMe)}${tags}`
      : `${who(victimName, victimMe)} ${info.cable ? 'se enredó en los cables ⚡' : 'se cortó solo'}`,
  );
  if (victimMe) {
    if (info.cable) {
      hud.announce('¡SE ENREDÓ EN LOS CABLES!', 'bad', 'El tendido eléctrico corta cualquier hilo');
    } else if (cutterName) {
      if (!serverCredits()) session.add('cutBy');
      telemetry.track('cut_by', { cable: false });
      hud.announce('¡TE CORTARON!', 'bad', cutterName);
      hud.toast('Corre a buscar volantines caídos o encumbra otro.', 4, 'bad');
    } else {
      hud.toast('Se cortó tu hilo de tanto tirarlo. ¡Anda a buscarlo!', 5, 'bad');
    }
    resetCombo(comboOf(player.id));
    audio.cutBy();
    loseFromBag();
    setTimeout(() => void session.flush(), 1000);
  } else if (cutterMe) {
    if (!serverCredits()) {
      session.add('cuts');
      if (info.combo > 1) session.add('comboCuts');
      session.add('bestCombo', info.combo);
      if (info.upset) session.add('upsets');
      if (info.bonus) session.add('bonusCuts');
    }
    telemetry.track('cut', { combo: info.combo, upset: info.upset, bonus: info.bonus });
    const sub = `a ${victimName}${info.upset ? ' · ¡contra la corriente!' : ''}${info.bonus ? ' · ✨ zona bonus' : ''}`;
    hud.announce(info.combo > 1 ? `¡${comboName(info.combo)}!` : '¡CORTASTE!', info.combo > 1 ? 'combo' : 'cut', sub);
    if (info.streak)
      setTimeout(() => {
        hud.announce('¡ENCACHADO!', 'streak', `Más filo y recuperación por ${COMBO.streakTime} s`);
        audio.streak();
      }, 800);
    audio.cut();
    if (info.combo > 1) audio.combo(info.combo);
    rig.shake(0.35);
    if (mode === 'solo') slowmo = 0.5;
    player.character.playOnce('emote-yes');
    setTimeout(() => void session.flush(), 1000);
  } else {
    audio.cutFar();
  }
}

/** Con la mochila cargada se te cae un volantín donde estás (online lo deja caer el servidor). */
function loseFromBag() {
  const lost = bag.pop();
  if (!lost) return;
  hud.toast(`🎒 Se te cayó el volantín de ${lost.ownerName} de la mochila`, 4, 'bad');
  if (mode === 'solo') {
    const def = KITES.find((k) => k.id === lost.kite) ?? KITES[1];
    fallen.addDropped(lost, def, { ...player.loadout, kite: def }, player.pos, player.id, time + DROP_LOCK);
  }
}

// --- Charchazos ---
/** Quién cortó a quién (modo solo), para saber si un charchazo es venganza. Online lo decide el servidor. */
const revenge = new RevengeBook();
/** Botón de tirar apretado el paso anterior (a pie, apretarlo es pegar). */
let prevTirar = false;

/** Un charchazo (en solo, o avisado por el servidor): animaciones, empujón, anuncios y mochila. */
function onHit(att: Flyer, vic: Flyer, d: { x: number; z: number }, isRevenge: boolean) {
  devLog('hit', { by: att.name, victim: vic.name, revenge: isRevenge });
  att.facing = Math.atan2(vic.pos.x - att.pos.x, vic.pos.z - att.pos.z);
  att.character.playOnce('attack-melee-right');
  att.brawl.cooldownUntil = time + BRAWL.cooldown;
  vic.character.knockdown(BRAWL.stun);
  vic.brawl.stunUntil = time + BRAWL.stun;
  vic.brawl.guardUntil = time + BRAWL.stun + BRAWL.guard;
  vic.knock = { x: d.x * BRAWL.knockSpeed, z: d.z * BRAWL.knockSpeed, until: time + BRAWL.knockTime };
  sparks.burst({ x: vic.pos.x, y: vic.pos.y + 1.4, z: vic.pos.z }, att === player || vic === player ? 12 : 6);
  const near = Math.hypot(player.pos.x - vic.pos.x, player.pos.z - vic.pos.z) < 40;
  if (att === player || vic === player || near) audio.slap();
  hud.feed(`${who(att.name, att === player)} 👋 ${who(vic.name, vic === player)}${isRevenge ? '<span class="tag">VENGANZA</span>' : ''}`);
  if (att === player) {
    telemetry.track('hit', { revenge: isRevenge });
    hud.announce(isRevenge ? '¡VENGANZA!' : '¡CHARCHAZO!', isRevenge ? 'streak' : 'crit', `a ${vic.name}`);
    rig.shake(0.15);
  } else if (vic === player) {
    hud.announce('¡TE BOTARON!', 'bad', isRevenge ? `${att.name} se vengó` : `charchazo de ${att.name}`);
    rig.shake(0.3);
    loseFromBag();
  }
}

/** Intenta un charchazo de un bot enojado a quien persigue (modo solo). */
function botTryHit(bot: Flyer): boolean {
  const target = flyers.find((f) => f.id === bot.revengeOn);
  if (!target || time < bot.brawl.cooldownUntil || time < target.brawl.guardUntil) return false;
  bot.facing = Math.atan2(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
  if (!brawlTarget(bot, [target], () => true)) return false;
  onHit(bot, target, knockDir(bot.pos, target.pos), revenge.take(bot.id, target.id, time));
  return true;
}

/** A quién le llegaría tu charchazo ahora (a pie, fuera de la espera y sin estar botado). */
function hitTarget(): Flyer | null {
  if (player.flying || time < player.brawl.cooldownUntil || time < player.brawl.stunUntil) return null;
  return brawlTarget(player, flyers, (f) => time >= f.brawl.guardUntil);
}

/** Le cortaron la cola a alguien: sin cola el volantín cabecea. */
function onTailCut(byMe: boolean, victimMe: boolean, byName: string, victimName: string, p: V3) {
  devLog('tail', { byMe, victimMe, byName, victimName });
  sparks.burst(p, byMe || victimMe ? 16 : 8);
  hud.feed(`${who(byName, byMe)} ✂️ cola de ${who(victimName, victimMe)}`);
  if (byMe) {
    if (!serverCredits()) session.add('tailCuts');
    telemetry.track('tail');
    hud.announce('¡COLA CORTADA!', 'crit', `a ${victimName}: ahora va a cabecear`);
    audio.tail();
    rig.shake(0.1);
  } else if (victimMe) {
    hud.announce('¡TE CORTARON LA COLA!', 'bad', `${byName} · ahora tu volantín cabecea`);
    audio.tail();
  }
}

/** Golpe crítico: chispas grandes y, si te toca, anuncio y sonido. */
function onCrit(byMe: boolean, victimMe: boolean, byName: string, kind: ManeuverKind, p: V3) {
  devLog('crit', { byMe, victimMe, byName, kind });
  sparks.burst(p, byMe || victimMe ? 26 : 12);
  if (byMe) {
    if (!serverCredits()) session.add('crits');
    telemetry.track('crit', { kind });
    hud.announce('¡CRÍTICO!', 'crit', maneuverName(kind));
    audio.crit();
    rig.shake(0.15);
  } else if (victimMe) {
    hud.announce('¡CRÍTICO EN CONTRA!', 'bad', `${maneuverName(kind).toLowerCase()} de ${byName}`);
    audio.crit();
  }
}

// --- Simulación a paso fijo ---
function fixedStep(dt: number) {
  time += dt;
  stepCount++;
  const inp = input.state;

  // A pie, apretar tirar es pegar un charchazo
  const hitPressed = (inp.tirar && !prevTirar) || input.consumeHit();
  prevTirar = inp.tirar;
  if (hitPressed && input.enabled && !player.flying && time >= player.brawl.cooldownUntil && time >= player.brawl.stunUntil) {
    if (mode === 'online') {
      // El servidor decide a quién le llega; aquí solo el gesto (y una espera corta para no mandar de más)
      online.send({ t: 'hit' });
      player.character.playOnce('attack-melee-right');
      player.brawl.cooldownUntil = time + 0.4;
    } else {
      const target = brawlTarget(player, flyers, (f) => time >= f.brawl.guardUntil);
      if (target) onHit(player, target, knockDir(player.pos, target.pos), revenge.take(player.id, target.id, time));
      else {
        player.character.playOnce('attack-melee-right');
        player.brawl.cooldownUntil = time + 0.4;
      }
    }
  }

  // Tú: con volantín caminas; libre, corres. Adelante es hacia donde mira la cámara.
  const stunned = time < player.brawl.stunUntil;
  const speed = player.flying ? WALK_WITH_KITE : RUN_FREE;
  const mlen = Math.hypot(inp.moveX, inp.moveY);
  const k = mlen > 1 ? 1 / mlen : 1;
  let vx = (rig.forward.x * inp.moveY + rig.right.x * inp.moveX) * k * speed;
  let vz = (rig.forward.z * inp.moveY + rig.right.z * inp.moveX) * k * speed;
  // Botado: no te mueves ni manejas el volantín; solo te arrastra el empujón
  if (stunned) {
    vx = time < player.knock.until ? player.knock.x : 0;
    vz = time < player.knock.until ? player.knock.z : 0;
  }
  // No se camina dentro del mar ni de la laguna
  if (!walkable(player.pos.x + vx * dt * 8, player.pos.z + vz * dt * 8)) vx = vz = 0;
  const facing = player.facing;
  player.step(dt, player.flying && !stunned ? inp : NO_KITE, vx, vz, windFor(player.altitude));
  // El empujón no te da vuelta
  if (stunned) player.facing = facing;
  if (inp.tiron) input.consumeTiron();
  const pk = player.kite;
  if (pk && player.flying && pk.maneuverAge === 0) {
    if (pk.maneuver === 1) audio.tiron();
    else audio.largada();
  }

  if (mode === 'online') {
    // Online: cruces, cortes y capturas los decide el servidor. Aquí solo el corte por desgaste.
    if (player.kite?.broken) {
      online.send({ t: 'broken' });
      player.detachKite()?.view.dispose();
      onCut(player.name, true, null, false, { combo: 0, upset: false, streak: false, bonus: false, cable: false });
    }
    fallen.step(dt, windFor);
    playerStats(dt);
    return;
  }

  // Bots
  const views: BotView[] = flyers.filter((f) => f.flying).map((f) => ({ id: f.id, anchor: f.anchor, kite: f.kite!, lo: f.loadout }));
  const windNow = windFor(10);
  for (const bot of bots) {
    // Botado por un charchazo: no hace nada, solo lo arrastra el empujón
    if (time < bot.brawl.stunUntil) {
      const kn = time < bot.knock.until;
      const f = bot.facing;
      bot.step(dt, NO_KITE, kn ? bot.knock.x : 0, kn ? bot.knock.z : 0, windFor(bot.altitude));
      bot.facing = f;
      continue;
    }
    const { input: bi, move } = updateBot(bot, {
      dt,
      wind: windNow,
      rivals: views.filter((v) => v.id !== bot.id),
      fallen,
      contacts: contactsNow,
      rand,
      revengeTarget: (b) => (b.revengeOn === player.id ? player.pos : null),
      tryHit: botTryHit,
    });
    bot.step(dt, bi, move.x, move.z, windFor(bot.altitude));
  }

  // Cruces de hilos (a 60 Hz alcanza)
  if (stepCount % 2 === 0) {
    for (const f of flyers) f.boosted = streakActive(comboOf(f.id), time);
    const lines = flyers.map((f) => f.lineBody()).filter((l): l is LineBody => !!l);
    // Cables del tendido: gastan el hilo que los toca
    playerOnCable = false;
    for (const hit of resolveCables(lines, cables, dt * 2)) {
      const f = flyers.find((x) => x.id === hit.id)!;
      f.lastDamager = 'cable';
      if (f === player) playerOnCable = true;
      if (stepCount % 8 === 0) sparks.burst(hit.point, 2);
    }
    const contacts = resolveCrossings(lines, dt * 2, hooks);
    contactsNow.clear();
    playerCrossing = null;
    for (const c of contacts) {
      contactsNow.add(c.a).add(c.b);
      const a = flyers.find((f) => f.id === c.a)!;
      const b = flyers.find((f) => f.id === c.b)!;
      a.lastDamager = b.id;
      b.lastDamager = a.id;
      if (a === player) playerCrossing = b.name;
      if (b === player) playerCrossing = a.name;
      if (stepCount % 6 === 0) sparks.burst(c.point, 3);
      for (const cr of c.crits) {
        const by = cr.by === a.id ? a : b;
        onCrit(by === player, cr.victim === player.id, by.name, cr.kind, c.point);
      }
    }
    for (const tc of resolveTailCuts(lines)) {
      const by = flyers.find((f) => f.id === tc.by)!;
      const victim = flyers.find((f) => f.id === tc.victim)!;
      onTailCut(by === player, victim === player, by.name, victim.name, tc.point);
    }
  }

  // Volantines cortados: pasan a caer solos
  for (const f of flyers) {
    if (!f.kite?.broken) continue;
    const byCross = f.kite.integrity <= 0;
    const cutter = byCross ? flyers.find((o) => o.id === f.lastDamager) ?? null : null;
    resetCombo(comboOf(f.id));
    const info: CutInfo = { combo: 0, upset: false, streak: false, bonus: false, cable: byCross && f.lastDamager === 'cable' };
    if (cutter) {
      revenge.cut(f.id, cutter.id, time);
      // A veces el bot que cortaste va enojado a pegarte
      if (f.isBot && cutter === player && rand() < BRAWL.botRevengeChance) {
        f.botState = 'vengar';
        f.revengeOn = player.id;
        f.botTimer = BRAWL.botRevengeTime;
      }
      const r = registerCut(comboOf(cutter.id), time);
      info.combo = r.combo;
      info.streak = r.streakStarted;
      info.upset = isUpset(cutter.loadout.line, f.loadout.line);
      info.bonus = !!cutter.kite && inBonus(activeMap(), cutter.kite.pos);
    }
    onCut(f.name, f === player, cutter?.name ?? null, cutter === player, info);
    const detached = f.detachKite();
    if (detached) fallen.add(f, detached);
  }

  fallen.step(dt, windFor);
  const full = bag.length >= myBag().capacidad;
  if (full && performance.now() > bagFullToast) {
    const near = fallen.nearest(player.pos);
    if (near && near.dist < myPole().alcance + 1) {
      bagFullToast = performance.now() + 6000;
      hud.toast(`🎒 Mochila llena (${bag.length}/${myBag().capacidad}): ve a dejar los volantines a tu casa 🏠`, 4, 'bad');
    }
  }
  const botPole = poleOf('mano');
  for (const { fallen: fk, by } of fallen.captures(flyers, (f) => (f === player ? (full ? null : myPole()) : botPole), time)) {
    if (by === player) {
      pickUp({ design: fk.design, kite: fk.lo.kite.id, owner: fk.owner, ownerName: fk.ownerName }, fk.owner === player.id);
    } else {
      const whose = fk.owner === by.id ? 'recuperó su volantín' : `capturó el volantín de ${fk.owner === player.id ? 'ti' : fk.ownerName}`;
      hud.toast(`${by.name} ${whose}`, 3, fk.owner === player.id ? 'bad' : 'info');
      by.botState = 'volver';
    }
  }

  // Entrega: con volantines en la mochila y parado en tu casa
  if (bag.length && Math.hypot(player.pos.x - player.home.x, player.pos.z - player.home.z) <= DELIVERY_RADIUS) deliver(bag.slice());

  playerStats(dt);
}

/** Estadísticas de tu vuelo para el progreso (igual en solo y online). */
function playerStats(dt: number) {
  const pk = player.kite;
  if (player.flying && !pk!.grounded && player.altitude > 3) {
    session.add('flightSeconds', dt);
    player.flightTime += dt;
    session.add('longestFlight', Math.floor(player.flightTime));
    session.add('bestAltitude', Math.floor(player.altitude));
    if (!fullLineCounted && pk!.lineLength >= player.loadout.reel.maxLine - 0.3) {
      fullLineCounted = true;
      session.add('fullLine');
      hud.toast('Todo el hilo afuera: ya no queda más en el carrete.', 3);
    }
  } else if (pk?.grounded) {
    player.flightTime = 0;
  }
  if (pk?.stowed && !wasStowed) {
    session.add('stows');
    hud.toast('Volantín guardado. Anda a buscar los que caigan o encumbra de nuevo.', 5);
  }
  wasStowed = !!pk?.stowed;
}

/** Eventos que mandó el servidor: lista de la sala, cortes, volantines caídos y capturas. */
function handleNetEvents() {
  const nameOf = (id: string | null) => (id ? (online.info.get(id)?.name ?? '?') : '');
  for (const e of online.events.splice(0)) {
    if (e.t === 'info') syncRemotes(online.info);
    else if (e.t === 'cut') {
      const victimMe = e.victim === online.myId;
      const cutterMe = !!e.cutter && e.cutter === online.myId;
      if (victimMe) player.detachKite()?.view.dispose();
      if (cutterMe) {
        // Sigue tu racha localmente para mostrar cuánto le queda (el servidor es el que la aplica)
        const c = comboOf(player.id);
        const active = streakActive(c, time);
        c.count = e.combo ?? 1;
        c.last = time;
        if (e.streak || active) c.streakUntil = time + COMBO.streakTime;
      }
      // Tu propio corte por desgaste ya se anunció al avisarle al servidor
      if (victimMe && !e.cutter) continue;
      onCut(nameOf(e.victim), victimMe, e.cutter ? nameOf(e.cutter) : null, cutterMe, {
        combo: e.combo ?? 1,
        upset: !!e.upset,
        streak: !!e.streak,
        bonus: !!e.bonus,
        cable: !!e.cable,
      });
    } else if (e.t === 'tail') {
      if (e.victim === online.myId && player.kite) player.kite.tailCut = true;
      onTailCut(e.by === online.myId, e.victim === online.myId, nameOf(e.by), nameOf(e.victim), { x: e.p[0], y: e.p[1], z: e.p[2] });
    } else if (e.t === 'crit') {
      onCrit(e.by === online.myId, e.victim === online.myId, nameOf(e.by), e.kind, { x: e.p[0], y: e.p[1], z: e.p[2] });
    } else if (e.t === 'fallen') {
      const def = KITES.find((k) => k.id === e.kite) ?? KITES[1];
      fallen.addNet(e, def, { ...player.loadout, kite: def });
    } else if (e.t === 'captured') {
      const fk = fallen.removeById(e.fallen);
      if (!fk || !e.by) continue;
      if (e.by === online.myId) {
        pickUp({ design: fk.design, kite: fk.lo.kite.id, owner: fk.owner, ownerName: fk.ownerName }, fk.owner === online.myId);
      } else {
        const whose = fk.owner === e.by ? 'recuperó su volantín' : `capturó el volantín de ${fk.owner === online.myId ? 'ti' : fk.ownerName}`;
        hud.toast(`${nameOf(e.by)} ${whose}`, 3, fk.owner === online.myId ? 'bad' : 'info');
      }
    } else if (e.t === 'delivered') {
      if (e.by === online.myId) deliver(e.items);
      else hud.feed(`${escapeHtml(nameOf(e.by))} 🏠 entregó ${e.items.length} ${e.items.length === 1 ? 'volantín' : 'volantines'}`);
    } else if (e.t === 'rewards') {
      // Premios que acreditó el servidor a tu cuenta (cortes, críticos, entregas en la sala)
      session.applyServer(e.player as unknown as Parameters<Session['applyServer']>[0], e.rewards as Parameters<Session['applyServer']>[1]);
    } else if (e.t === 'hit') {
      const att = e.by === online.myId ? player : remotes.get(e.by);
      const vic = e.victim === online.myId ? player : remotes.get(e.victim);
      if (att && vic) onHit(att, vic, { x: e.d[0], z: e.d[1] }, !!e.revenge);
    } else if (e.t === 'closed') {
      hud.toast(`${e.reason} Sigues jugando solo.`, 5, 'bad');
      goSolo();
    }
  }
}

// --- Bucle principal ---
let last = performance.now();
let acc = 0;
let fpsTime = 0;
let fpsFrames = 0;
let lowQuality = false;
const tmpV = new THREE.Vector3();

function frame(now: number) {
  requestAnimationFrame(frame);
  // Tope de FPS: se salta cuadros hasta que toque (con 1 ms de holgura)
  if (graphics.fps && now - last < 1000 / graphics.fps - 1) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  input.update();
  if (input.consumeReset() && input.enabled) {
    // R: encumbra si estás libre o si el volantín quedó en el suelo
    if (!player.flying || player.kite!.grounded) launchPlayer();
  }
  if (input.consumeDebug()) void toggleDebug();
  if (input.consumeMenu()) {
    if (menu.open) menu.close();
    else openMenu();
  }
  hud.setTouch(input.isTouch);

  if (mode === 'online') {
    // La hora de la sala manda (el viento es igual para todos)
    time = online.serverNow();
    handleNetEvents();
  }

  // Cámara lenta al cortar (solo en modo solo: online el tiempo lo manda la sala)
  acc += mode === 'solo' && slowmo > 0 ? dt * 0.3 : dt;
  slowmo = Math.max(0, slowmo - dt);
  let steps = 0;
  while (acc >= FIXED_DT && steps < 12) {
    fixedStep(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === 12) acc = 0;

  if (mode === 'online') {
    for (const [id, r] of remotes) {
      const st = online.sample(id);
      if (st) r.applyNet(st);
      r.boosted = !!online.latest(id)?.b;
    }
    fallen.syncNet(online.fallen);
    const mine = online.latest(online.myId);
    player.boosted = !!mine?.b;
    if (player.kite && mine && mine.s.fid === player.fid) player.kite.integrity = mine.I;
    playerCrossing = mine?.x ? (online.info.get(mine.x)?.name ?? null) : null;
    sendTimer -= dt;
    if (sendTimer <= 0) {
      sendTimer = 1 / NET_RATE;
      online.send({ t: 'state', s: player.netState() });
    }
    if (voice.active) {
      voice.setTalking(pttHeld || (input.talkHeld && !menu.open));
      camera.getWorldDirection(camDir);
      voice.update(player.pos, camDir, (id) => remotes.get(id)?.pos ?? null);
    }
  }

  const wind = windFor(player.altitude);
  // Letreros: 💫 botado por un charchazo, 🔊 hablando por la voz
  for (const f of flyers) f.setTagIcon(time < f.brawl.stunUntil ? '💫' : voice.speaking.has(f.id) ? '🔊' : null);
  const target = input.enabled ? hitTarget() : null;
  // En el celular manda el botón redondo GOLPEAR; el aviso de texto es solo para teclado
  hud.setHitHint(input.isTouch ? null : (target?.name ?? null));
  input.setHitState(input.enabled && !player.flying, !!target);

  for (const f of flyers) {
    f.render(dt, time, windFor(f.altitude));
    // En racha el volantín va soltando chispas
    if (f.boosted && f.flying && Math.random() < dt * 10) sparks.burst(f.kite!.pos, 2);
  }

  // Recién cruzado: el momento del golpe crítico
  const nowS = now / 1000;
  const crossing = player.flying && !!playerCrossing;
  if (crossing && !wasCrossing) {
    critMomentUntil = nowS + CUT.critWindow;
    try {
      if (!localStorage.getItem(CRIT_TIP_KEY)) {
        localStorage.setItem(CRIT_TIP_KEY, '1');
        hud.toast(input.isTouch ? '¡Cruzado! Toca ⚡ TIRÓN justo ahora para un golpe crítico.' : '¡Cruzado! Aprieta F justo ahora para un golpe crítico.', 5, 'gold');
      }
    } catch {
      // sin almacenamiento el consejo simplemente no se recuerda
    }
  }
  wasCrossing = crossing;
  const critMoment = crossing && nowS < critMomentUntil;
  input.setTironState(player.flying, (player.kite?.tironCooldown ?? 1) <= 0, critMoment);
  const myCombo = comboOf(player.id);
  audio.update({
    windSpeed: Math.hypot(wind.x, wind.z),
    altitude: player.altitude,
    flying: player.flying,
    tension: player.kite?.tension ?? 0,
    crossing,
  });
  fallen.render(dt, time, windFor);
  sparks.update(dt);
  const turn = input.consumeTurn(dt);
  rig.update(dt, player.pos, player.flying ? player.kite!.pos : null, input.consumeZoom(), player.flying ? 0 : turn);
  world.update(dt, wind, player.pos, time);

  reportTimer -= dt;
  // Con el menú abierto no se reporta: evita redibujarlo mientras escribes
  if (reportTimer <= 0 && !menu.open) {
    reportTimer = REPORT_EVERY;
    void session.flush();
  }

  // Flecha al volantín caído más cercano (en coordenadas de pantalla)
  const near = fallen.nearest(player.pos);
  let fallenHud: { dist: number; angle: number } | null = null;
  if (near && near.dist > 3) {
    tmpV.set(near.fallen.kite.pos.x - player.pos.x, 0, near.fallen.kite.pos.z - player.pos.z);
    fallenHud = {
      dist: near.dist,
      angle: Math.atan2(tmpV.x * rig.right.x + tmpV.z * rig.right.z, tmpV.x * rig.forward.x + tmpV.z * rig.forward.z),
    };
  }

  // Flecha a tu casa cuando llevas volantines
  let homeHud: { dist: number; angle: number } | null = null;
  const homeDist = Math.hypot(player.home.x - player.pos.x, player.home.z - player.pos.z);
  if (bag.length && homeDist > DELIVERY_RADIUS) {
    tmpV.set(player.home.x - player.pos.x, 0, player.home.z - player.pos.z);
    homeHud = { dist: homeDist, angle: Math.atan2(tmpV.x * rig.right.x + tmpV.z * rig.right.z, tmpV.x * rig.forward.x + tmpV.z * rig.forward.z) };
  }
  homeMarker.update(time, bag.length > 0);

  const k = player.kite;
  hud.update(
    {
      flying: player.flying,
      altitude: player.altitude,
      lineLength: player.flying ? k!.lineLength : 0,
      maxLine: player.loadout.reel.maxLine,
      stress: player.flying ? k!.stress : 0,
      wear: player.flying ? k!.wear : 0,
      integrity: player.flying ? k!.integrity : 100,
      crossingWith: playerCrossing,
      windSpeed: Math.hypot(wind.x, wind.z),
      windScreenAngle: Math.atan2(wind.x * rig.right.x + wind.z * rig.right.z, wind.x * rig.forward.x + wind.z * rig.forward.z),
      fallen: fallenHud,
      streak: streakActive(myCombo, time) ? myCombo.streakUntil - time : null,
      bag: { n: bag.length, cap: myBag().capacidad },
      home: homeHud,
      inBonus: player.flying && inBonus(activeMap(), player.kite!.pos),
      onCable: player.flying && playerOnCable,
      critMoment,
    },
    dt,
  );

  renderer.render(scene, camera);

  // Modo gráfico bajo automático si el equipo no alcanza 30 FPS
  fpsTime += dt;
  fpsFrames++;
  if (fpsTime > 3) {
    const fps = fpsFrames / fpsTime;
    if (graphics.quality === 'auto' && fps < 30 && !lowQuality && !menu.open && document.visibilityState === 'visible') {
      lowQuality = true;
      pixelRatio = 1;
      renderer.setPixelRatio(pixelRatio);
      renderer.shadowMap.enabled = false;
      world.sun.castShadow = false;
      resize();
    }
    fpsTime = 0;
    fpsFrames = 0;
  }
}
requestAnimationFrame(frame);
