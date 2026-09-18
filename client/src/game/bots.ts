import * as THREE from 'three';
import { createBrain, randomBot, spawnSlot, updateBotBody, type BotView, type KiteInput, type V3 } from '@volantines/shared';
import { loadoutFrom } from '../profile';
import type { FallenKites } from './fallen';
import { Flyer } from './flyer';

/** Crea bots (modo solo) en los puestos alrededor de la cima, cada uno con su look, volantín y estilo. */
export function createBots(scene: THREE.Scene, count: number, shadows: boolean, ropePoints: number, rand: () => number): Flyer[] {
  const bots: Flyer[] = [];
  for (let i = 0; i < count; i++) {
    const b = randomBot(i, rand);
    const bot = new Flyer(
      scene,
      { id: `bot-${i}`, name: b.name, isBot: true, look: b.look, design: b.design, loadout: loadoutFrom(b.gear), shadows, ropePoints, tagColor: '#cfe3f4' },
      spawnSlot(i + 1),
    );
    bot.brain = createBrain(rand, b.skill);
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

/** Decide qué hace un bot este paso (la lógica vive en shared y es la misma del servidor). */
export function updateBot(bot: Flyer, ctx: BotContext): { input: KiteInput; move: { x: number; z: number } } {
  return updateBotBody(bot, {
    ...ctx,
    nearestFallen: (p) => {
      const n = ctx.fallen.nearest(p);
      return n ? { pos: n.fallen.kite.pos, dist: n.dist } : null;
    },
    launch: () => bot.launch(ctx.wind.x, ctx.wind.z),
  });
}
