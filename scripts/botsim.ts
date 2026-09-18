// Simulación de bots peleando (sin navegador) para medir cruces, críticos y cortes.
// Uso: npx tsx scripts/botsim.ts [segundos] [bots]
import {
  BRIDLES,
  KITES,
  LINES,
  REELS,
  Rope,
  createBrain,
  createKite,
  groundHeight,
  randomBot,
  resolveCrossings,
  resolveTailCuts,
  spawnSlot,
  stepKite,
  updateBotBody,
  windAt,
  type BotBody,
  type Hook,
  type LineBody,
} from '../shared/src';

const seconds = Number(process.argv[2] ?? 300);
const count = Number(process.argv[3] ?? 4);
const DT = 1 / 120;
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T extends { id: string }>(l: T[], id: string) => l.find((i) => i.id === id)!;

type Sim = BotBody & { rope: Rope; name: string };
const bots: Sim[] = [];
for (let i = 0; i < count; i++) {
  const b = randomBot(i, rand);
  const s = spawnSlot(i + 1);
  const pos = { x: s.x, y: groundHeight(s.x, s.z), z: s.z };
  bots.push({
    id: `b${i}`,
    name: b.name,
    pos,
    home: { ...pos },
    anchor: { x: pos.x, y: pos.y + 1.25, z: pos.z },
    kite: null,
    loadout: { kite: pick(KITES, b.gear.kite), line: pick(LINES, b.gear.line), reel: pick(REELS, b.gear.reel), bridle: pick(BRIDLES, b.gear.bridle) },
    brain: createBrain(rand, b.skill),
    botState: 'esperar',
    botTimer: 1 + rand() * 2,
    rope: new Rope(16),
  });
}

const hooks = new Map<string, Hook>();
const contacts = new Set<string>();
let contactTime = 0;
let hooksStarted = 0;
let crits = 0;
let cuts = 0;
let wearBreaks = 0;
let tails = 0;
const tirones = { n: 0 };
let t = 0;
let step = 0;
for (; t < seconds; t += DT, step++) {
  const wind = windAt(t, 10);
  const views = bots.filter((b) => b.kite && !b.kite.broken && !b.kite.stowed).map((b) => ({ id: b.id, anchor: b.anchor, kite: b.kite!, lo: b.loadout }));
  for (const b of bots) {
    const { input, move } = updateBotBody(b, {
      dt: DT,
      wind,
      rivals: views.filter((v) => v.id !== b.id),
      contacts,
      rand,
      nearestFallen: () => null,
      launch: () => {
        const l = Math.hypot(wind.x, wind.z);
        b.kite = createKite(b.anchor, wind.x / l, wind.z / l, rand() * 100);
        b.rope.reset(b.anchor, b.kite.pos);
      },
    });
    if (input.tiron) tirones.n++;
    b.pos.x += move.x * DT;
    b.pos.z += move.z * DT;
    b.pos.y = groundHeight(b.pos.x, b.pos.z);
    b.anchor.x = b.pos.x;
    b.anchor.y = b.pos.y + 1.25;
    b.anchor.z = b.pos.z;
    const k = b.kite;
    if (!k) continue;
    const w = windAt(t, k.pos.y - groundHeight(k.pos.x, k.pos.z));
    stepKite(k, b.loadout, input, b.anchor, { x: move.x, y: 0, z: move.z }, w, DT);
    if (!k.stowed) b.rope.step(b.anchor, k.broken ? null : k.pos, k.lineLength * (1.004 + 0.03 * (1 - k.tension)), { x: w.x * 0.15, y: -9.8, z: w.z * 0.15 }, 0.02, DT, 8);
  }
  if (step % 2 === 0) {
    const before = hooks.size;
    const lines: LineBody[] = bots.filter((b) => b.kite && !b.kite.broken && !b.kite.stowed).map((b) => ({ id: b.id, pts: b.rope.pts, kite: b.kite!, lo: b.loadout }));
    const cs = resolveCrossings(lines, DT * 2, hooks);
    contacts.clear();
    for (const c of cs) {
      contacts.add(c.a).add(c.b);
      crits += c.crits.length;
    }
    if (cs.length) contactTime += DT * 2;
    tails += resolveTailCuts(lines).length;
    if (hooks.size > before) hooksStarted += hooks.size - before;
  }
  for (const b of bots) {
    if (!b.kite?.broken) continue;
    if (b.kite.integrity <= 0) cuts++;
    else wearBreaks++;
    b.kite = null;
    b.botState = 'volver';
  }
}
console.log(JSON.stringify({ seconds, bots: count, hooksStarted, contactSeconds: +contactTime.toFixed(1), crits, cuts, tails, wearBreaks, tironesPedidos: tirones.n }));
