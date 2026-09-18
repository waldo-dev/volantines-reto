import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 90;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export async function createSession(playerId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO sessions (token, player_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [
    token,
    playerId,
  ]);
  return token;
}

/** Id del jugador dueño del token, o null si no existe o venció. */
export async function playerFromToken(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const { rows } = await pool.query<{ player_id: number }>('SELECT player_id FROM sessions WHERE token = $1 AND expires_at > now()', [token]);
  return rows[0]?.player_id ?? null;
}

export async function deleteSession(token: string) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

/** Nombres de 3 a 16 caracteres: letras (con tildes y ñ), números, espacio, guion y guion bajo. */
export function validName(name: unknown): name is string {
  return typeof name === 'string' && /^[\p{L}\p{N} _-]{3,16}$/u.test(name.trim());
}

export function validPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 4 && pw.length <= 100;
}
