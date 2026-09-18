import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { isMapId, type ClientMsg, type ServerMsg } from '@volantines/shared';
import { playerFromToken } from './auth';
import { pool } from './db';
import { loadPlayer } from './players';
import { Lobby, type Room } from './room';

const MAX_MSG = 8 * 1024;
const MAX_MSGS_PER_SEC = 40;

export const lobby = new Lobby();

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

    ws.on('message', async (raw) => {
      // Límite de mensajes por segundo por conexión
      if (Date.now() - windowStart > 1000) {
        windowStart = Date.now();
        count = 0;
      }
      if (++count > MAX_MSGS_PER_SEC) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

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
        });
        joining = false;
        return;
      }
      if (!room || !human) return;
      if (msg.t === 'state') room.setState(human, msg.s);
      else if (msg.t === 'broken') room.selfBroken(human);
      else if (msg.t === 'profile') room.updateProfile(human, { ...msg, name: human.progress ? human.name : cleanName(msg.name) });
    });

    ws.on('close', () => {
      if (room && human) room.leave(human);
    });
  });
  return wss;
}
