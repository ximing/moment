import { config } from '../config.js';
import { getBaAuthToken } from '../embeddings/ba-auth.js';

export const BA_HTTP_TIMEOUT_MS = 10_000;

function origin(): string {
  return config.INTERNAL_API_BASE_URL.replace(/\/+$/, '');
}

async function baFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BA_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${getBaAuthToken()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === 'AbortError'
        ? `BA request timed out after ${BA_HTTP_TIMEOUT_MS}ms`
        : `BA network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function deleteInternalEmbeddings(momentId: string): Promise<number> {
  const resp = await baFetch(`${origin()}/api/internal/embeddings/${momentId}`, { method: 'DELETE' });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`BA HTTP ${resp.status}`);
  const json = (await resp.json()) as { deleted?: number };
  return typeof json.deleted === 'number' ? json.deleted : 0;
}

export async function upsertInternalEmbedding(body: {
  momentId: string;
  chainId: string;
  kind: 'moment' | 'image';
  mediaId?: string;
  vector: number[];
  modelHash: string;
}): Promise<void> {
  const resp = await baFetch(`${origin()}/api/internal/embeddings`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`BA HTTP ${resp.status}`);
}
