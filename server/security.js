import { randomBytes, scrypt as rawScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(rawScrypt);
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export function secureEqual(a, b) {
  const aa = Buffer.from(String(a ?? '')), bb = Buffer.from(String(b ?? ''));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw Object.assign(new Error('Choisis un mot de passe de 10 à 128 caractères.'), { status: 400 });
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}
export function validHash(encoded) { return /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded || ''); }
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || !validHash(encoded)) return false;
  const [, n, r, p, salt, key] = encoded.split('$');
  const actual = await scrypt(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
export function username(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$/.test(value.trim())) throw Object.assign(new Error('Identifiant : 3 à 24 lettres, chiffres, points, tirets ou tirets bas.'), { status: 400 });
  return value.trim().toLowerCase();
}
export function nickname(value) {
  if (typeof value !== 'string') throw new Error('Choisis un pseudo.');
  const out = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (out.length < 2 || out.length > 18) throw new Error('Pseudo : 2 à 18 caractères.');
  return out;
}
export function requestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(value)) throw Object.assign(new Error('Identifiant de requête invalide.'), { status: 400 });
  return value;
}
export function cents(value, min = 0, max = 1000000000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Object.assign(new Error('Montant invalide (centimes entiers requis).'), { status: 400 });
  return value;
}
export function note(value) {
  if (typeof value !== 'string' || value.trim().length < 4 || value.length > 180) throw new Error('Ajoute un motif de 4 à 180 caractères.');
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
}
