import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CATALOG } from '@volantines/shared';
import { createSession, deleteSession, hashPassword, playerFromToken, validName, validPassword, verifyPassword } from './auth';
import { migrate, pool } from './db';
import {
  HttpError,
  achievementList,
  buy,
  createPlayer,
  findByName,
  loadPlayer,
  publicPlayer,
  rename,
  report,
  saveCustomization,
  withPlayer,
} from './players';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = path.resolve(import.meta.dirname, '../../client/dist');
const MAX_BODY = 64 * 1024;

type Handler = (ctx: { body: any; token?: string; playerId: number | null }) => Promise<unknown>;

const needPlayer = (id: number | null): number => {
  if (id === null) throw new HttpError(401, 'Tu sesión expiró. Vuelve a entrar.');
  return id;
};

/** Intentos fallidos de inicio de sesión por IP, para frenar a quien pruebe claves. */
const failedLogins = new Map<string, { count: number; until: number }>();

const routes: Record<string, Handler> = {
  'GET /api/health': async () => ({ ok: true }),

  'GET /api/catalog': async () => ({ items: CATALOG, achievements: achievementList() }),

  'POST /api/auth/register': async ({ body }) => {
    const name = String(body?.name ?? '').trim();
    if (!validName(name)) throw new HttpError(400, 'El nombre debe tener entre 3 y 16 letras o números.');
    if (!validPassword(body?.password)) throw new HttpError(400, 'La clave debe tener al menos 4 caracteres.');
    const id = await createPlayer(name, await hashPassword(body.password));
    if (id === null) throw new HttpError(409, 'Ese nombre ya está ocupado.');
    const token = await createSession(id);
    return { token, player: publicPlayer((await loadPlayer(pool, id))!) };
  },

  'POST /api/auth/login': async ({ body }) => {
    const name = String(body?.name ?? '');
    const row = await findByName(name);
    if (!row || !(await verifyPassword(String(body?.password ?? ''), row.pass_hash))) {
      throw new HttpError(401, 'Nombre o clave incorrectos.');
    }
    const token = await createSession(row.id);
    return { token, player: publicPlayer((await loadPlayer(pool, row.id))!) };
  },

  'POST /api/auth/logout': async ({ token }) => {
    if (token) await deleteSession(token);
    return { ok: true };
  },

  'GET /api/me': async ({ playerId }) => ({ player: publicPlayer((await loadPlayer(pool, needPlayer(playerId)))!) }),

  'PUT /api/me': async ({ body, playerId }) =>
    withPlayer(needPlayer(playerId), async (p, db) => {
      if (body?.name !== undefined && body.name !== p.name) {
        const name = String(body.name).trim();
        if (!validName(name)) throw new HttpError(400, 'El nombre debe tener entre 3 y 16 letras o números.');
        await rename(p, db, name);
      }
      await saveCustomization(p, db, body ?? {});
      return { player: publicPlayer(p) };
    }),

  'POST /api/shop/buy': async ({ body, playerId }) =>
    withPlayer(needPlayer(playerId), async (p, db) => {
      await buy(p, db, String(body?.item ?? ''));
      return { player: publicPlayer(p) };
    }),

  'POST /api/me/report': async ({ body, playerId }) =>
    withPlayer(needPlayer(playerId), async (p, db) => {
      const rewards = await report(p, db, body?.events ?? {}, body?.captured);
      return { player: publicPlayer(p), rewards };
    }),
};

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Demasiados datos.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

/** Sirve el cliente compilado (client/dist) para publicar todo en un solo proceso. */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = path.join(STATIC_DIR, urlPath);
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'Prohibido' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, { error: 'Compila el cliente con npm run build.' });
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: 'Ruta desconocida.' });

  const ip = req.socket.remoteAddress ?? '?';
  const isLogin = url.pathname === '/api/auth/login';
  const block = failedLogins.get(ip);
  if (isLogin && block && block.until > Date.now()) return send(res, 429, { error: 'Muchos intentos. Espera un minuto.' });

  try {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || undefined;
    const body = req.method === 'GET' ? {} : await readBody(req);
    const playerId = await playerFromToken(token);
    const data = await handler({ body, token, playerId });
    if (isLogin) failedLogins.delete(ip);
    send(res, 200, data);
  } catch (err) {
    if (err instanceof HttpError) {
      if (isLogin && err.status === 401) {
        const f = failedLogins.get(ip) ?? { count: 0, until: 0 };
        f.count++;
        if (f.count >= 8) {
          f.until = Date.now() + 60_000;
          f.count = 0;
        }
        failedLogins.set(ip, f);
      }
      return send(res, err.status, { error: err.message });
    }
    console.error(err);
    send(res, 500, { error: 'Error del servidor.' });
  }
});

await migrate();
server.listen(PORT, () => console.log(`servidor volantines-reto en http://localhost:${PORT}`));
