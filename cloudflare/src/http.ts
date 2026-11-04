export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers });
}

export function failure(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500) console.error('Request failed', error instanceof Error ? error.name : 'unknown');
  return json({ error: { code: String(status), message: error instanceof HttpError ? error.message : 'Internal server error' } }, status);
}

export async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  const text = await limitedBody(request, 16 * 1024);
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(text));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

export function field(body: Record<string, unknown>, key: string, max = 256): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `Invalid ${key}`);
  return value;
}

export async function limitedBody(request: Request, max: number): Promise<Uint8Array> {
  const size = Number(request.headers.get('content-length'));
  if (size > max) throw new HttpError(413, 'File is too large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel(); throw new HttpError(413, 'File is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function integer(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, 'Invalid identifier');
  return n;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}
