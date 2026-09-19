import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { isMapId, VOICE, type ClientMsg, type ServerMsg } from '@volantines/shared';
import { playerFromToken } from './auth';
import { pool } from './db';
import { creditServer, loadPlayer, publicPlayer, withPlayer } from './players';
import { Lobby, type Room, type RoomServices } from './room';
import { recordServerEvent } from './telemetry';

const MAX_MSG = 8 * 1024;
const MAX_MSGS_PER_SEC = 40;

/** Base de datos y telemetría para las salas: acreditar premios que vio el servidor y registrar eventos. */
const services: RoomServices = {
  credit: (accountId, events, trophies) =>
    withPlayer(accountId, async (p, db) => {
      const rewards = await creditServer(p, db, events, trophies);
      return { player: publicPlayer(p) as unknown as Record<string, unknown>, rewards };
    }),
  event: (kind, accountId, data) => recordServerEvent(kind, accountId, data),
};

export const lobby = new Lobby(services);

const reply = (ws: WebSocket, msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const cleanName = (n: unknown) => (typeof n === 'string' && /^[\p{L}\p{N} _-]{1,16}$/u.test(n.trim()) ? n.trim() : 'Invitado');

/** WebSocket en /ws: el primer mensaje es "join"; después llegan estados, cortes por desgaste y cambios de perfil. */
export function attachWebSockets(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });

  wss.on('connection', (ws) => {
    let room: Room | null = null;
    let human: ReturnType<Room['join']> | null = null;
    let joining = false;
    let count = 0;
    let windowStart = Date.now();
    let signals = 0;

    ws.on('message', async (raw) => {
      // Límite de mensajes por segundo por conexión
      if (Date.now() - windowStart > 1000) {
        windowStart = Date.now();
        count = 0;
        signals = 0;
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      // Las señales de voz llegan en ráfagas al conectar con varios: tienen su propio límite
      if (msg?.t === 'rtc') {
        if (++signals > VOICE.maxSignalsPerSec) return;
      } else if (++count > MAX_MSGS_PER_SEC) return;

      if (msg.t === 'join') {
        if (room || joining) return;
        joining = true;
        const found = lobby.find(String(msg.room ?? ''), isMapId(msg.map) ? msg.map : 'cerro');
        if (typeof found === 'string') {
          joining = false;
          return reply(ws, { t: 'error', msg: found });
        }
        // Con cuenta: nombre y equipo salen de la base de datos (no se puede volar con lo que no tienes)
        const playerId = await playerFromToken(msg.token ?? undefined).catch(() => null);
        const account = playerId ? await loadPlayer(pool, playerId).catch(() => null) : null;
        room = found;
        human = room.join(ws, {
          name: account?.name ?? cleanName(msg.name),
          look: msg.look,
          design: msg.design,
          gear: account?.gear ?? msg.gear,
          progress: account,
          accountId: account?.id ?? null,
        });
        joining = false;
        return;
      }
      if (!room || !human) return;
      if (msg.t === 'state') room.setState(human, msg.s);
      else if (msg.t === 'broken') room.selfBroken(human);
      else if (msg.t === 'voice') room.setVoice(human, msg.on === true);
      else if (msg.t === 'rtc') room.relaySignal(human, String(msg.to ?? ''), msg.d);
      else if (msg.t === 'profile') room.updateProfile(human, { ...msg, name: human.progress ? human.name : cleanName(msg.name) });
    });

    ws.on('close', () => {
      if (room && human) room.leave(human);
    });
  });
  return wss;
}
