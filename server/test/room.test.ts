import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_GEAR, DEFAULT_LOOK, cableSegments, createKite, gearLoadout, groundHeight, mapById, tailSegment, useMap, type NetState, type ServerMsg } from '@volantines/shared';
import type { WebSocket } from 'ws';
import { Lobby, Room } from '../src/room';

/** Conexión falsa que guarda lo que el servidor le manda. */
function fakeSocket() {
  const msgs: ServerMsg[] = [];
  const ws = { OPEN: 1, readyState: 1, send: (d: string) => msgs.push(JSON.parse(d)) } as unknown as WebSocket;
  return { ws, msgs };
}

/** Estado de red de alguien cuyo hilo va recto de `from` a `to` (el volantín 20 m más arriba). */
function state(fid: number, from: [number, number, number], to: [number, number, number], maneuver?: { m: 1 | 2; ma: number }): NetState {
  const rope: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    rope.push(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t);
  }
  return {
    p: [from[0], from[1] - 1.2, from[2]],
    v: [0, 0],
    f: 0,
    fid,
    // Hilo justo lo necesario para llegar de la mano al volantín (la validación del servidor lo exige)
    k: {
      p: [to[0], to[1] + 20, to[2]],
      v: [0, 0, 0],
      h: 0,
      a: 0.7,
      L: Math.max(57, Math.hypot(to[0] - from[0], to[1] + 20 - (from[1] + 0.05), to[2] - from[2]) + 1),
      r: 0,
      T: 0.5,
      w: 0,
      g: 0,
      s: 0,
      ...(maneuver ?? {}),
    },
    rope,
  };
}

const profile = (name: string, kite = DEFAULT_GEAR.kite) => ({ name, look: DEFAULT_LOOK, design: DEFAULT_DESIGN, gear: { ...DEFAULT_GEAR, kite }, progress: null });
const rooms: Room[] = [];
afterEach(() => rooms.splice(0).forEach((r) => r.close()));

function twoPlayers() {
  const room = new Room('TESTS', true, () => undefined);
  rooms.push(room);
  const sa = fakeSocket();
  const sb = fakeSocket();
  const a = room.join(sa.ws, profile('Ana'));
  const b = room.join(sb.ws, profile('Beto'));
  const tick = () => (room as unknown as { tick(): void }).tick();
  return { room, a, b, sa, sb, tick };
}

const A_FROM: [number, number, number] = [-20, 10, -20];
const A_TO: [number, number, number] = [20, 10.1, 20];
const B_FROM: [number, number, number] = [-20, 10, 20];
const B_TO: [number, number, number] = [20, 10, -20];

describe('sala online: combate', () => {
  it('un tirón justo al cruzarse llega a todos como golpe crítico', () => {
    const { room, a, b, sb, tick } = twoPlayers();
    room.setState(a, state(1, A_FROM, A_TO, { m: 1, ma: 0.1 }));
    room.setState(b, state(1, B_FROM, B_TO));
    tick();
    const crit = sb.msgs.find((m) => m.t === 'crit');
    expect(crit).toMatchObject({ t: 'crit', by: a.id, victim: b.id, kind: 1 });
    expect(b.integrity).toBeLessThan(75);
    // No se repite en el mismo enganche
    sb.msgs.length = 0;
    tick();
    expect(sb.msgs.some((m) => m.t === 'crit')).toBe(false);
  });

  it('cortar seguido suma combo, y el tercero enciende la racha', () => {
    const { room, a, b, sa, tick } = twoPlayers();
    const cuts: Extract<ServerMsg, { t: 'cut' }>[] = [];
    for (let fid = 1; fid <= 3; fid++) {
      room.setState(a, state(fid, A_FROM, A_TO));
      room.setState(b, state(fid, B_FROM, B_TO));
      b.integrity = 0.01; // a punto de cortarse
      sa.msgs.length = 0;
      tick();
      const cut = sa.msgs.find((m): m is Extract<ServerMsg, { t: 'cut' }> => m.t === 'cut' && m.victim === b.id);
      expect(cut).toBeTruthy();
      cuts.push(cut!);
    }
    expect(cuts.map((c) => c.cutter)).toEqual([a.id, a.id, a.id]);
    expect(cuts.map((c) => c.combo)).toEqual([undefined, 2, 3]);
    expect(cuts[2].streak).toBe(1);
    // En racha el snapshot lo marca
    room.setState(a, state(4, A_FROM, A_TO));
    sa.msgs.length = 0;
    tick();
    const snap = sa.msgs.find((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap')!;
    expect(snap.players.find((p) => p.id === a.id)?.b).toBe(1);
    expect(snap.players.find((p) => p.id === b.id)?.b).toBeUndefined();
  });

  it('al ser cortado se pierde el combo', () => {
    const { room, a, b, sa, tick } = twoPlayers();
    room.setState(a, state(1, A_FROM, A_TO));
    room.setState(b, state(1, B_FROM, B_TO));
    b.integrity = 0.01;
    tick(); // Ana corta a Beto (combo 1)
    room.setState(a, state(2, A_FROM, A_TO));
    room.setState(b, state(2, B_FROM, B_TO));
    a.integrity = 0.01;
    tick(); // Beto corta a Ana
    room.setState(a, state(3, A_FROM, A_TO));
    room.setState(b, state(3, B_FROM, B_TO));
    b.integrity = 0.01;
    sa.msgs.length = 0;
    tick();
    const cut = sa.msgs.find((m): m is Extract<ServerMsg, { t: 'cut' }> => m.t === 'cut');
    expect(cut).toMatchObject({ victim: b.id, cutter: a.id });
    expect(cut!.combo).toBeUndefined();
  });
});

describe('sala online: colas', () => {
  it('un latigazo cerca de la cola de una cambucha se la corta, y se avisa una sola vez', () => {
    const room = new Room('COLAS', true, () => undefined);
    rooms.push(room);
    const sa = fakeSocket();
    const sb = fakeSocket();
    const ana = room.join(sa.ws, profile('Ana', 'cambucha'));
    const beto = room.join(sb.ws, profile('Beto'));
    const tick = () => (room as unknown as { tick(): void }).tick();
    // Ana vuela una cambucha (con cola) hacia +x; Beto pasa su hilo justo por donde le cuelga la cola
    const anaState = state(1, [0, 10, 0], [40, 10, 0]);
    const k = anaState.k!;
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: anaState.rope![i * 3], y: anaState.rope![i * 3 + 1], z: anaState.rope![i * 3 + 2] }));
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const kite = { pos: { x: k.p[0], y: k.p[1], z: k.p[2] } };
    tailSegment({ id: 'x', pts, kite: kite as never, lo: gearLoadout({ ...DEFAULT_GEAR, kite: 'cambucha' }) }, a, b);
    const mid: [number, number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
    // Hilos de menos de 80 m: los invitados vuelan con el carrete de mano
    const betoState = state(1, [mid[0] - 18, 10, mid[2] - 18], [mid[0] + 18, mid[1] * 2 - 10, mid[2] + 18], { m: 1, ma: 0.1 });
    room.setState(ana, anaState);
    room.setState(beto, betoState);
    tick();
    const tail = sa.msgs.filter((m) => m.t === 'tail');
    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({ by: beto.id, victim: ana.id });
    // El cliente de Ana todavía no manda tc: 1, pero el servidor ya sabe que no tiene cola
    tick();
    expect(sa.msgs.filter((m) => m.t === 'tail')).toHaveLength(1);
  });
});

describe('sala online: mochila', () => {
  /** Pone un volantín caído (ya en el suelo) justo en `p`. */
  function dropAt(room: Room, id: string, p: [number, number, number], kite = 'mediano') {
    const k = createKite({ x: p[0], y: p[1], z: p[2] }, 1, 0);
    k.pos = { x: p[0], y: p[1], z: p[2] };
    k.broken = true;
    k.grounded = true;
    (room as unknown as { fallen: unknown[] }).fallen.push({
      id,
      owner: 'b9',
      ownerName: 'Pancho',
      design: DEFAULT_DESIGN,
      lo: gearLoadout({ ...DEFAULT_GEAR, kite }),
      kite: k,
      groundTime: 0,
    });
  }

  function onePlayer() {
    const room = new Room('BOLSA', true, () => undefined);
    rooms.push(room);
    const s = fakeSocket();
    const ana = room.join(s.ws, profile('Ana'));
    const tick = () => (room as unknown as { tick(): void }).tick();
    return { room, ana, s, tick };
  }

  /** Estado de Ana parada en (x, z), sin volantín. */
  const standing = (fid: number, x: number, z: number): NetState => ({ p: [x, groundHeight(x, z), z], v: [0, 0], f: 0, fid });

  it('recoge hasta llenar la bolsa (2) y el resto se queda en el suelo', () => {
    const { room, ana, s, tick } = onePlayer();
    const x = 40;
    const z = 0;
    const y = groundHeight(x, z);
    room.setState(ana, standing(1, x, z));
    for (const id of ['f1', 'f2', 'f3']) dropAt(room, id, [x, y + 0.2, z]);
    tick();
    tick();
    const mine = s.msgs.filter((m) => m.t === 'captured' && m.by === ana.id);
    expect(mine).toHaveLength(2);
    expect(ana.bag).toHaveLength(2);
  });

  it('en su casa entrega la mochila; si lo cortan cargado, se le cae un volantín', () => {
    const { room, ana, s, tick } = onePlayer();
    const y = groundHeight(40, 0);
    room.setState(ana, standing(1, 40, 0));
    dropAt(room, 'f1', [40, y + 0.2, 0], 'condor');
    dropAt(room, 'f2', [40, y + 0.2, 0]);
    tick();
    expect(ana.bag.map((i) => i.kite).sort()).toEqual(['condor', 'mediano']);
    // Se corta solo (desgaste) estando cargado: se le cae el último
    room.setState(ana, { ...standing(2, 40, 0), k: { p: [60, 30, 0], v: [0, 0, 0], h: 0, a: 0.7, L: 40, r: 0, T: 0.5, w: 1, g: 0, s: 0 } });
    s.msgs.length = 0;
    room.selfBroken(ana);
    expect(ana.bag).toHaveLength(1);
    expect(s.msgs.filter((m) => m.t === 'fallen')).toHaveLength(2); // su volantín y el que se le cayó
    // Parada ahí mismo, no puede recoger de nuevo el que se le cayó
    s.msgs.length = 0;
    tick();
    expect(s.msgs.some((m) => m.t === 'captured' && m.by === ana.id)).toBe(false);
    expect(ana.bag).toHaveLength(1);
    // Vuelve a su casa: entrega lo que le queda
    // Camina a su casa (un rato después: la validación no deja teletransportarse)
    room.setState(ana, standing(3, ana.home.x, ana.home.z), performance.now() / 1000 + 60);
    s.msgs.length = 0;
    tick();
    const delivered = s.msgs.find((m): m is Extract<ServerMsg, { t: 'delivered' }> => m.t === 'delivered');
    expect(delivered?.by).toBe(ana.id);
    expect(delivered?.items).toHaveLength(1);
    expect(ana.bag).toHaveLength(0);
  });
});

describe('sala online: escenarios', () => {
  afterEach(() => useMap('cerro'));

  it('la partida rápida separa las salas por mapa y el mapa llega en la bienvenida', () => {
    const lobby = new Lobby();
    const a = lobby.find('', 'playa') as Room;
    const b = lobby.find('', 'playa') as Room;
    const c = lobby.find('', 'cerro') as Room;
    rooms.push(a, c);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    const s = fakeSocket();
    a.join(s.ws, profile('Ana'));
    expect(s.msgs.find((m) => m.t === 'welcome')).toMatchObject({ map: 'playa' });
  });

  it('en Valparaíso un hilo enredado en el cable se corta y se avisa como corte de cable', () => {
    const room = new Room('CABLE', true, () => undefined, 'valparaiso');
    rooms.push(room);
    const s = fakeSocket();
    const ana = room.join(s.ws, profile('Ana'));
    const tick = () => (room as unknown as { tick(): void }).tick();
    useMap('valparaiso');
    const c = cableSegments(mapById('valparaiso'), groundHeight)[0];
    const mid: [number, number, number] = [(c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2, (c.a.z + c.b.z) / 2];
    // Hilo recto que atraviesa el cable (de abajo por un lado a arriba por el otro)
    room.setState(ana, state(1, [mid[0], mid[1] - 8, mid[2] - 12], [mid[0], mid[1] + 8, mid[2] + 12]));
    ana.integrity = 0.2;
    tick();
    const cut = s.msgs.find((m): m is Extract<ServerMsg, { t: 'cut' }> => m.t === 'cut' && m.victim === ana.id);
    expect(cut).toMatchObject({ cutter: null, cable: 1 });
  });
});

describe('sala online: el servidor acredita a las cuentas', () => {
  it('cortes y entregas de una cuenta se acreditan (juntos) y se avisan; los invitados no', async () => {
    const credits: { id: number; events: Record<string, number>; trophies: number }[] = [];
    const events: string[] = [];
    const services = {
      credit: async (id: number, ev: Record<string, number>, trophies: unknown[]) => {
        credits.push({ id, events: { ...ev }, trophies: trophies.length });
        return { player: { name: 'Ana', coins: 999 }, rewards: { coins: 55, xp: 110, levelUp: null, achievements: [] } };
      },
      event: (kind: string) => void events.push(kind),
    };
    const room = new Room('CUENT', true, () => undefined, 'cerro', services as never);
    rooms.push(room);
    const sa = fakeSocket();
    const sb = fakeSocket();
    const ana = room.join(sa.ws, { ...profile('Ana'), accountId: 7 });
    const beto = room.join(sb.ws, profile('Beto')); // invitado
    const tick = () => (room as unknown as { tick(): void }).tick();
    // Ana corta a Beto
    room.setState(ana, state(1, A_FROM, A_TO));
    room.setState(beto, state(1, B_FROM, B_TO));
    beto.integrity = 0.01;
    tick();
    // Y entrega un cóndor en su casa
    ana.bag.push({ design: DEFAULT_DESIGN, kite: 'condor', owner: 'b1', ownerName: 'Pancho' });
    room.setState(ana, { p: [ana.home.x, groundHeight(ana.home.x, ana.home.z), ana.home.z], v: [0, 0], f: 0, fid: 2 }, performance.now() / 1000 + 60);
    tick();
    await new Promise((r) => setTimeout(r, 1000));
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ id: 7, trophies: 1 });
    // El cóndor es legendario: 30 × 3 = 90 → 60 de extra (lo calcula el servidor con su colihue)
    expect(credits[0].events).toMatchObject({ cuts: 1, captures: 1, captureBonus: 60, bestDelivery: 1, bestCombo: 1 });
    expect(sa.msgs.some((m) => m.t === 'rewards')).toBe(true);
    expect(sb.msgs.some((m) => m.t === 'rewards')).toBe(false);
    expect(events).toEqual(expect.arrayContaining(['cut', 'cut_by', 'delivery']));
  });

  it('estados imposibles se corrigen y, si se repiten, quedan como sospechosos', () => {
    const events: { kind: string; data?: Record<string, unknown> }[] = [];
    const services = { credit: async () => null, event: (kind: string, _id: number | null, data?: Record<string, unknown>) => void events.push({ kind, data }) };
    const room = new Room('TRAMP', true, () => undefined, 'cerro', services);
    rooms.push(room);
    const s = fakeSocket();
    const h = room.join(s.ws, profile('Tramposo'));
    // Avanza 15 m cada 0,05 s (300 m/s) muchas veces seguidas
    for (let i = 0; i < 60; i++) room.setState(h, { p: [-200 + i * 15, 0, 0], v: [0, 0], f: 0, fid: 1 }, i * 0.05);
    // En 3 s avanzó lo que se puede correr (con holgura), no 885 m
    expect(h.state!.p[0]).toBeLessThan(-100);
    expect(events.filter((e) => e.kind === 'suspect')).toHaveLength(1);
    expect(events[0].data).toMatchObject({ name: 'Tramposo' });
  });
});
