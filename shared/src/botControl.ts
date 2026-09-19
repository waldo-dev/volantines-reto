import { botThink, createBrain, type BotBrain, type BotView } from './bot';
import { BRAWL } from './brawl';
import { CHARACTERS, COLOR_SWATCHES, HATS, PATTERNS, type Gear, type KiteDesign, type Look } from './cosmetics';
import type { KiteInput, KiteState, Loadout } from './kite';
import type { V3 } from './vec';

export const BOT_NAMES = ['Pancho', 'La Rucia', 'Don Lucho', 'Cote', 'El Flaco', 'Tía Marta'];
const BOT_KITES = ['mediano', 'mediano', 'cambucha', 'necla', 'chonchon'];
const BOT_KITES_GOOD = ['mediano', 'necla', 'chonchon', 'grande', 'gigante'];

const pick = <T>(list: readonly T[], rand: () => number) => list[Math.floor(rand() * list.length)];

/** Nombre, look, volantín, equipo y habilidad al azar para un bot. */
export function randomBot(i: number, rand: () => number): { name: string; look: Look; design: KiteDesign; gear: Gear; skill: number } {
  const skill = 0.35 + rand() * 0.5;
  const colors = [pick(COLOR_SWATCHES, rand), pick(COLOR_SWATCHES, rand), pick(COLOR_SWATCHES, rand)] as [string, string, string];
  return {
    name: BOT_NAMES[i % BOT_NAMES.length],
    look: {
      character: pick(CHARACTERS, rand).id,
      hat: pick(HATS, rand).id,
      hatColor: pick(COLOR_SWATCHES, rand),
      glasses: rand() < 0.25 ? 'sunglasses' : 'none',
    },
    design: { pattern: pick(PATTERNS.filter((p) => p.id !== 'chile'), rand).id, colors, tail: colors[0] },
    gear: {
      kite: pick(skill > 0.65 ? BOT_KITES_GOOD : BOT_KITES, rand),
      line: pick(skill > 0.7 ? ['curado', 'curado-vidrio', 'curado-trenzado'] : skill > 0.5 ? ['algodon-encerado', 'curado'] : ['algodon', 'algodon-encerado'], rand),
      reel: 'mano',
      bridle: rand() < 0.35 ? 'cabeceador' : 'normal',
    },
    skill,
  };
}

/** Puestos alrededor de la cima del cerro (8 lugares), para que nadie quede encima de otro. */
export function spawnSlot(i: number): V3 {
  const a = -Math.PI / 2 + ((i % 8) - 3.5) * 0.62;
  const r = i === 0 ? 0 : 10 + (i % 3) * 3;
  return { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r };
}

/** Lo mínimo que necesita la máquina de estados de un bot (lo cumplen el Flyer del cliente y el bot del servidor). */
export interface BotBody {
  id: string;
  pos: V3;
  anchor: V3;
  home: V3;
  kite: KiteState | null;
  loadout: Loadout;
  brain: BotBrain | null;
  botState: 'volar' | 'perseguir' | 'volver' | 'esperar' | 'vengar';
  botTimer: number;
  /** A quién va a pegarle (estado 'vengar'). */
  revengeOn?: string | null;
}

export interface BotControlContext {
  dt: number;
  wind: V3;
  rivals: BotView[];
  contacts: Set<string>;
  rand: () => number;
  /** Volantín caído más cercano a un punto. */
  nearestFallen: (p: V3) => { pos: V3; dist: number } | null;
  /** Saca un volantín nuevo a favor del viento. */
  launch: (bot: BotBody) => void;
  /** Dónde está aquel al que el bot va a pegarle (null si ya no está o no se puede). */
  revengeTarget?: (bot: BotBody) => V3 | null;
  /** Intenta el charchazo; true si le pegó. */
  tryHit?: (bot: BotBody) => boolean;
}

const WALK = 4.5;
const RUN = 6;
const IDLE: KiteInput = { tirar: false, soltar: false, dirX: 0 };

function walkTo(bot: BotBody, target: V3, speed = WALK) {
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return { x: 0, z: 0, dist: d };
  const s = Math.min(speed, d * 2);
  return { x: (dx / d) * s, z: (dz / d) * s, dist: d };
}

const windDir = (w: V3) => {
  const l = Math.hypot(w.x, w.z) || 1;
  return { x: w.x / l, y: 0, z: w.z / l };
};

/**
 * Máquina de estados del bot: esperar → volar → (si lo cortan) perseguir volantines caídos → volver.
 * Devuelve la entrada del volantín y la velocidad a la que camina.
 */
export function updateBotBody(bot: BotBody, ctx: BotControlContext): { input: KiteInput; move: { x: number; z: number } } {
  const brain = bot.brain!;
  brain.inContact = ctx.contacts.has(bot.id);
  const none = { x: 0, z: 0 };

  switch (bot.botState) {
    case 'esperar': {
      bot.botTimer -= ctx.dt;
      if (bot.botTimer <= 0) {
        ctx.launch(bot);
        Object.assign(brain, createBrain(ctx.rand, brain.skill), { aggression: brain.aggression });
        bot.botState = 'volar';
      }
      return { input: IDLE, move: none };
    }
    case 'volar': {
      if (!bot.kite) {
        bot.botState = 'perseguir';
        return { input: IDLE, move: none };
      }
      if (bot.kite.stowed || (bot.kite.grounded && bot.kite.lineLength > 12)) {
        bot.botState = 'esperar';
        bot.botTimer = 3;
        return { input: IDLE, move: none };
      }
      const self: BotView = { id: bot.id, anchor: bot.anchor, kite: bot.kite, lo: bot.loadout };
      return { input: botThink(brain, self, ctx.rivals, windDir(ctx.wind), ctx.dt, ctx.rand), move: none };
    }
    case 'vengar': {
      // Enojado: va a pegarle al que lo cortó; se aburre al rato y sigue buscando volantines
      bot.botTimer -= ctx.dt;
      const target = ctx.revengeTarget?.(bot) ?? null;
      if (!target || bot.botTimer <= 0) {
        bot.botState = 'perseguir';
        bot.revengeOn = null;
        return { input: IDLE, move: none };
      }
      const m = walkTo(bot, target, RUN);
      if (m.dist < BRAWL.range * 0.8 && ctx.tryHit?.(bot)) {
        bot.botState = 'perseguir';
        bot.revengeOn = null;
      }
      return { input: IDLE, move: m.dist < BRAWL.range * 0.6 ? none : m };
    }
    case 'perseguir': {
      const near = ctx.nearestFallen(bot.pos);
      if (!near || near.dist > 140) {
        bot.botState = 'volver';
        return { input: IDLE, move: none };
      }
      return { input: IDLE, move: walkTo(bot, near.pos) };
    }
    case 'volver': {
      const m = walkTo(bot, bot.home);
      if (m.dist < 1) {
        bot.botState = 'esperar';
        bot.botTimer = 2 + ctx.rand() * 3;
      }
      return { input: IDLE, move: m };
    }
  }
}
