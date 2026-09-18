import * as THREE from 'three';
import {
  BRIDLES,
  CHARACTERS,
  HATS,
  KITES,
  LINES,
  PATTERNS,
  REELS,
  botThink,
  byId,
  createBrain,
  type BotView,
  type KiteInput,
  type V3,
} from '@volantines/shared';
import { COLOR_SWATCHES } from '../kiteDesigns';
import type { FallenKites } from './fallen';
import { Flyer } from './flyer';

const BOT_NAMES = ['Pancho', 'La Rucia', 'Don Lucho', 'Cote', 'El Flaco', 'Tía Marta'];
const WALK = 4.5;
const pick = <T>(list: readonly T[], rand: () => number) => list[Math.floor(rand() * list.length)];

/** Crea bots repartidos alrededor de la cima del cerro, cada uno con su look, su volantín y su estilo. */
export function createBots(scene: THREE.Scene, count: number, shadows: boolean, ropePoints: number, rand: () => number): Flyer[] {
  const bots: Flyer[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i - (count - 1) / 2) * 0.9 + (rand() - 0.5) * 0.3;
    const r = 11 + rand() * 6;
    const skill = 0.35 + rand() * 0.5;
    const colors = [pick(COLOR_SWATCHES, rand), pick(COLOR_SWATCHES, rand), pick(COLOR_SWATCHES, rand)] as [string, string, string];
    const bot = new Flyer(
      scene,
      {
        id: `bot-${i}`,
        name: BOT_NAMES[i % BOT_NAMES.length],
        isBot: true,
        look: {
          character: pick(CHARACTERS, rand).id,
          hat: pick(HATS, rand).id,
          hatColor: pick(COLOR_SWATCHES, rand),
          glasses: rand() < 0.25 ? 'sunglasses' : 'none',
        },
        design: { pattern: pick(PATTERNS.filter((p) => p.id !== 'chile'), rand).id, colors, tail: colors[0] },
        loadout: {
          kite: byId(KITES, rand() < 0.3 ? 'grande' : 'mediano'),
          line: byId(LINES, skill > 0.65 ? 'curado' : 'algodon'),
          reel: byId(REELS, 'mano'),
          bridle: byId(BRIDLES, rand() < 0.35 ? 'cabeceador' : 'normal'),
        },
        shadows,
        ropePoints,
        tagColor: '#cfe3f4',
      },
      { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r },
    );
    bot.brain = createBrain(rand, skill);
    bots.push(bot);
  }
  return bots;
}

export interface BotContext {
  dt: number;
  wind: V3;
  rivals: BotView[];
  fallen: FallenKites;
  contacts: Set<string>;
  rand: () => number;
}

const IDLE: KiteInput = { tirar: false, soltar: false, dirX: 0 };

function walkTo(bot: Flyer, target: V3) {
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return { x: 0, z: 0, dist: d };
  const s = Math.min(WALK, d * 2);
  return { x: (dx / d) * s, z: (dz / d) * s, dist: d };
}

/**
 * Máquina de estados del bot: esperar → volar → (si lo cortan) perseguir volantines caídos → volver.
 * Devuelve la entrada del volantín y la velocidad a la que camina.
 */
export function updateBot(bot: Flyer, ctx: BotContext): { input: KiteInput; move: { x: number; z: number } } {
  const brain = bot.brain!;
  brain.inContact = ctx.contacts.has(bot.id);
  const none = { x: 0, z: 0 };

  switch (bot.botState) {
    case 'esperar': {
      bot.botTimer -= ctx.dt;
      if (bot.botTimer <= 0) {
        bot.launch(ctx.wind.x, ctx.wind.z);
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
      return { input: botThink(brain, self, ctx.rivals, Flyer.windDir(ctx.wind), ctx.dt, ctx.rand), move: none };
    }
    case 'perseguir': {
      const near = ctx.fallen.nearest(bot.pos);
      if (!near || near.dist > 140) {
        bot.botState = 'volver';
        return { input: IDLE, move: none };
      }
      const m = walkTo(bot, near.fallen.kite.pos);
      return { input: IDLE, move: m };
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
