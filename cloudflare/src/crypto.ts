import { HttpError } from './http';

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}

export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}

const ITERATIONS = 600_000;
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('');
}

export function validPassword(password: string): void {
  if (password.length < 8 || password.length > 1024) throw new HttpError(400, 'Password must be between 8 and 1024 characters');
}

export async function hashPassword(password: string): Promise<string> {
  validPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${Array.from(salt, n => n.toString(16).padStart(2, '0')).join('')}$${await derive(password, salt, ITERATIONS)}`;
}

export function constantEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, rounds, salt, expected] = hash.split('$');
  if (scheme !== 'pbkdf2-sha256' || Number(rounds) !== ITERATIONS || !/^[a-f0-9]{32}$/.test(salt ?? '') || password.length > 1024) return false;
  const bytes = Uint8Array.from(salt.match(/../g)!, x => parseInt(x, 16));
  return constantEqual(await derive(password, bytes, ITERATIONS), expected);
}
