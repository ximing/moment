import { createHash } from 'node:crypto';

export type EmbeddingModality = 'text' | 'image' | 'vl';

export interface EmbeddingRequest {
  text?: string;
  /** 派生 WebP 的 data URI。禁止原图、禁止公网 URL。 */
  imageDataUri?: string;
}

export interface EmbeddingProvider {
  embed(req: EmbeddingRequest): Promise<number[]>;
  modelHash(): string;
  dimensions(): number;
}

export const EMBEDDING_TIMEOUT_MS = 20_000;
export const MULTIMODAL_EMBEDDING_PATH = '/services/embeddings/multimodal-embedding/multimodal-embedding';

export function computeEmbeddingModelHash(model: string, dim: number, outputType: string): string {
  return createHash('sha256').update(`${model}:${dim}:${outputType}`).digest('hex');
}

export class RetryableEmbeddingError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableEmbeddingError';
  }
}

/** processor 只认 error.name === 'NonRetryableEmbeddingError'。handler 禁止自写 outbox.status。 */
export class NonRetryableEmbeddingError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableEmbeddingError';
  }
}
