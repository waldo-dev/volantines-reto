import * as THREE from 'three';
import { KITES, NET_RATE, groundHeight, resolveCrossings, windAt, type BotView, type KiteInput, type LineBody, type NetPlayerInfo } from '@volantines/shared';
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

const FIXED_DT = 1 / 120;
const WALK_WITH_KITE = 3.5;
const RUN_FREE = 6;
const REPORT_EVERY = 15;

// --- Render ---
const canvas = document.getElementById('game') as HTMLCanvasElement;
const isMobile = window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = !isMobile;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 3000);
const world = createWorld(scene, { shadows: !isMobile, mobile: isMobile });
if (import.meta.env.DEV) Object.assign(window, { __game: { renderer, scene, camera } });

let rotateDismissed = false;
const rotateEl = document.getElementById('rotate')!;
rotateEl.addEventListener('pointerdown', () => {
  rotateDismissed = true;
  rotateEl.hidden = true;
});

// --- Sesión, entrada e interfaz ---
const session = new Session();
const input = new Input(canvas, document.getElementById('touch')!);
const hud = new Hud(document.getElementById('hud')!);
hud.setTouch(input.isTouch);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (input.isTouch && h > w && !rotateDismissed) rotateEl.hidden = false;
  if (w > h) rotateEl.hidden = true;
}
window.addEventListener('resize', resize);
resize();

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
const rig = new CameraRig(camera);

let time = 0;
let stepCount = 0;
const contactsNow = new Set<string>();
const hooks = new Set<string>(); // pares de hilos enganchados
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
  hud.setRoom(`Sala ${online.room}${online.isPrivate ? ' (privada)' : ''} · ${[...info.values()].filter((p) => !p.bot).length} jugadores`);
}

/** Entra a una sala online: '' partida rápida, 'NUEVA' sala privada, o un código. */
async function goOnline(room: string) {
  const d = session.data;
  await online.connect(room, { name: d.name, look: d.look, design: d.design, gear: d.gear, token: session.token });
  mode = 'online';
  for (const b of bots) b.dispose();
  bots = [];
  fallen.clear();
  hooks.clear();
  syncRemotes(online.info);
  time = online.serverNow();
  respawn(online.spawn[0], online.spawn[2]);
}

/** Vuelve al modo solo con bots locales. */
function goSolo() {
  online.close();
  mode = 'solo';
  for (const r of remotes.values()) r.dispose();
  remotes.clear();
  fallen.clear();
  hooks.clear();
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
    hud.toast(
      input.isTouch
        ? 'Mantén SOLTAR para darle hilo. TIRA cuando la punta apunte hacia arriba.'
        : 'Clic derecho (Shift) suelta hilo. Clic izquierdo (Espacio) tira: hazlo cuando la punta apunte hacia arriba.',
      6,
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

// --- Simulación a paso fijo ---
function fixedStep(dt: number) {
  time += dt;
  stepCount++;
  const inp = input.state;

  // Tú: con volantín caminas; libre, corres. Adelante es hacia donde mira la cámara.
  const speed = player.flying ? WALK_WITH_KITE : RUN_FREE;
  const mlen = Math.hypot(inp.moveX, inp.moveY);
  const k = mlen > 1 ? 1 / mlen : 1;
  const vx = (rig.forward.x * inp.moveY + rig.right.x * inp.moveX) * k * speed;
  const vz = (rig.forward.z * inp.moveY + rig.right.z * inp.moveX) * k * speed;
  player.step(dt, player.flying ? inp : NO_KITE, vx, vz, windFor(player.altitude));

  if (mode === 'online') {
    // Online: cruces, cortes y capturas los decide el servidor. Aquí solo el corte por desgaste.
    if (player.kite?.broken) {
      online.send({ t: 'broken' });
      player.detachKite()?.view.dispose();
      hud.toast('Se cortó tu hilo de tanto tirarlo. ¡Anda a buscarlo!', 5, 'bad');
    }
    fallen.step(dt, windFor);
    playerStats(dt);
    return;
  }

  // Bots
  const views: BotView[] = flyers.filter((f) => f.flying).map((f) => ({ id: f.id, anchor: f.anchor, kite: f.kite!, lo: f.loadout }));
  const windNow = windFor(10);
  for (const bot of bots) {
    const { input: bi, move } = updateBot(bot, {
      dt,
      wind: windNow,
      rivals: views.filter((v) => v.id !== bot.id),
      fallen,
      contacts: contactsNow,
      rand,
    });
    bot.step(dt, bi, move.x, move.z, windFor(bot.altitude));
  }

  // Cruces de hilos (a 60 Hz alcanza)
  if (stepCount % 2 === 0) {
    const lines = flyers.map((f) => f.lineBody()).filter((l): l is LineBody => !!l);
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
    }
  }

  // Volantines cortados: pasan a caer solos
  for (const f of flyers) {
    if (!f.kite?.broken) continue;
    const byCross = f.kite.integrity <= 0;
    const cutter = byCross ? flyers.find((o) => o.id === f.lastDamager) ?? null : null;
    if (f === player) {
      if (cutter) {
        session.add('cutBy');
        hud.toast(`✂️ Te cortó ${cutter.name}. ¡Corre a buscar volantines caídos!`, 5, 'bad');
      } else {
        hud.toast('Se cortó tu hilo de tanto tirarlo. ¡Anda a buscarlo!', 5, 'bad');
      }
      setTimeout(() => void session.flush(), 1000);
    } else if (cutter === player) {
      session.add('cuts');
      hud.toast(`✂️ ¡Cortaste a ${f.name}!`, 4, 'good');
      player.character.playOnce('emote-yes');
      setTimeout(() => void session.flush(), 1000);
    } else if (cutter) {
      hud.toast(`${cutter.name} cortó a ${f.name}`, 3);
    }
    const detached = f.detachKite();
    if (detached) fallen.add(f, detached);
  }

  fallen.step(dt, windFor);
  for (const { fallen: fk, by } of fallen.captures(flyers)) {
    if (by === player) {
      session.capture(fk.design);
      hud.toast(fk.owner === player.id ? '🪁 ¡Recuperaste tu volantín!' : `🪁 ¡Capturaste el volantín de ${fk.ownerName}!`, 4, 'good');
      player.character.playOnce('pick-up');
      setTimeout(() => void session.flush(), 1000);
    } else {
      const whose = fk.owner === by.id ? 'recuperó su volantín' : `capturó el volantín de ${fk.owner === player.id ? 'ti' : fk.ownerName}`;
      hud.toast(`${by.name} ${whose}`, 3, fk.owner === player.id ? 'bad' : 'info');
      by.botState = 'volver';
    }
  }

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
      if (e.victim === online.myId) {
        player.detachKite()?.view.dispose();
        if (e.cutter) {
          session.add('cutBy');
          hud.toast(`✂️ Te cortó ${nameOf(e.cutter)}. ¡Corre a buscar volantines caídos!`, 5, 'bad');
        }
        setTimeout(() => void session.flush(), 1000);
      } else if (e.cutter === online.myId) {
        session.add('cuts');
        hud.toast(`✂️ ¡Cortaste a ${nameOf(e.victim)}!`, 4, 'good');
        player.character.playOnce('emote-yes');
        setTimeout(() => void session.flush(), 1000);
      } else if (e.cutter) {
        hud.toast(`${nameOf(e.cutter)} cortó a ${nameOf(e.victim)}`, 3);
      }
    } else if (e.t === 'fallen') {
      const def = KITES.find((k) => k.id === e.kite) ?? KITES[1];
      fallen.addNet(e, def, { ...player.loadout, kite: def });
    } else if (e.t === 'captured') {
      const fk = fallen.removeById(e.fallen);
      if (!fk || !e.by) continue;
      if (e.by === online.myId) {
        session.capture(fk.design);
        hud.toast(fk.owner === online.myId ? '🪁 ¡Recuperaste tu volantín!' : `🪁 ¡Capturaste el volantín de ${fk.ownerName}!`, 4, 'good');
        player.character.playOnce('pick-up');
        setTimeout(() => void session.flush(), 1000);
      } else {
        const whose = fk.owner === e.by ? 'recuperó su volantín' : `capturó el volantín de ${fk.owner === online.myId ? 'ti' : fk.ownerName}`;
        hud.toast(`${nameOf(e.by)} ${whose}`, 3, fk.owner === online.myId ? 'bad' : 'info');
      }
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

  acc += dt;
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
    }
    fallen.syncNet(online.fallen);
    const mine = online.latest(online.myId);
    if (player.kite && mine && mine.s.fid === player.fid) player.kite.integrity = mine.I;
    playerCrossing = mine?.x ? (online.info.get(mine.x)?.name ?? null) : null;
    sendTimer -= dt;
    if (sendTimer <= 0) {
      sendTimer = 1 / NET_RATE;
      online.send({ t: 'state', s: player.netState() });
    }
  }

  const wind = windFor(player.altitude);
  for (const f of flyers) f.render(dt, time, windFor(f.altitude));
  fallen.render(dt, time, windFor);
  sparks.update(dt);
  rig.update(dt, player.pos, player.flying ? player.kite!.pos : null, input.consumeZoom(), player.flying ? 0 : input.state.dirX);
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
    },
    dt,
  );

  renderer.render(scene, camera);

  // Modo gráfico bajo automático si el equipo no alcanza 30 FPS
  fpsTime += dt;
  fpsFrames++;
  if (fpsTime > 3) {
    const fps = fpsFrames / fpsTime;
    if (fps < 30 && !lowQuality && !menu.open && document.visibilityState === 'visible') {
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
