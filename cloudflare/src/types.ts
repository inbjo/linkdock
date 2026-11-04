export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  USER_FILES: DurableObjectNamespace;
  ASSETS: Fetcher;
  AUTH_LIMITER: RateLimit;
  PUBLIC_URL: string;
  SETUP_TOKEN?: string;
  REGISTRATION_ENABLED?: string;
  MAX_FILE_BYTES?: string;
  HISTORY_LIMIT?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface User {
  id: number;
  uuid: string;
  username: string;
  email: string;
  display_name: string;
  is_system_admin: number;
  disabled: number;
  password_hash: string;
}

export interface Identity {
  userId: number;
  owner: string;
  writable: boolean;
}
