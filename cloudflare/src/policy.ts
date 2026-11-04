import { HttpError } from './http';
import type { Env } from './types';

export interface Policy {
  registration_mode: 'closed' | 'invite' | 'open';
  turnstile_enabled: number;
  max_files: number;
  max_storage_bytes: number;
  max_tokens: number;
}
export interface Limits { max_files: number; max_storage_bytes: number; max_tokens: number }

export async function policy(env: Env): Promise<Policy> {
  return await env.DB.prepare('SELECT * FROM instance_settings WHERE id=1').first<Policy>() ?? {
    registration_mode: env.REGISTRATION_ENABLED === 'true' ? 'open' : 'closed',
    turnstile_enabled: 0, max_files: 100, max_storage_bytes: 104857600, max_tokens: 20,
  };
}

export async function limits(env: Env, userId: number): Promise<Limits> {
  const defaults = await policy(env);
  const overrides = await env.DB.prepare('SELECT max_files,max_storage_bytes,max_tokens FROM users WHERE id=?').bind(userId).first<Partial<Limits>>();
  return Object.fromEntries(Object.entries(defaults).filter(([key]) => key.startsWith('max_')).map(([key, value]) => [key, overrides?.[key as keyof Limits] ?? value])) as unknown as Limits;
}

export function limitValue(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new HttpError(400, 'Invalid quota');
  return value;
}

export async function verifyTurnstile(request: Request, env: Env, token: unknown): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) throw new HttpError(503, 'Turnstile is not configured');
  if (typeof token !== 'string' || !token || token.length > 2048) throw new HttpError(400, 'Complete the verification challenge');
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get('cf-connecting-ip') ?? '' }),
    });
    if (!response.ok) throw new Error();
    result = await response.json();
  } catch { throw new HttpError(503, 'Verification service unavailable; retry'); }
  if (!result.success || result.hostname !== new URL(env.PUBLIC_URL).hostname || result.action !== 'register') throw new HttpError(400, 'Verification failed; retry the challenge');
}
