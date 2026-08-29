import {
  EMBEDDING_TIMEOUT_MS,
  MULTIMODAL_EMBEDDING_PATH,
  NonRetryableEmbeddingError,
  RetryableEmbeddingError,
  computeEmbeddingModelHash,
  type EmbeddingProvider,
  type EmbeddingRequest,
} from './base.provider.js';

export interface DashScopeMultimodalProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
  outputType: string;
  timeoutMs?: number;
}

export class DashScopeMultimodalProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: DashScopeMultimodalProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  }

  dimensions(): number {
    return this.opts.dimension;
  }

  modelHash(): string {
    return computeEmbeddingModelHash(this.opts.model, this.opts.dimension, this.opts.outputType);
  }

  async embed(req: EmbeddingRequest): Promise<number[]> {
    const contents: Array<Record<string, string>> = [];
    if (req.text !== undefined && req.text.length > 0) contents.push({ text: req.text });
    if (req.imageDataUri) contents.push({ image: req.imageDataUri });
    if (contents.length === 0) throw new NonRetryableEmbeddingError('EMPTY_EMBEDDING_REQUEST');

    const parameters: Record<string, unknown> = {
      dimension: this.opts.dimension,
      output_type: this.opts.outputType,
    };
    if (contents.length > 1) parameters.enable_fusion = true;

    const url = `${this.baseUrl}${MULTIMODAL_EMBEDDING_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.opts.model,
          input: { contents },
          parameters,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new RetryableEmbeddingError(
        err instanceof Error && err.name === 'AbortError'
          ? `embedding request timed out after ${this.timeoutMs}ms`
          : `embedding network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (resp.status === 429 || resp.status >= 500) {
      throw new RetryableEmbeddingError(`embedding HTTP ${resp.status}`);
    }
    if (resp.status >= 400) {
      throw new NonRetryableEmbeddingError(`embedding HTTP ${resp.status}`);
    }

    let data: unknown;
    try {
      data = (await resp.json()) as unknown;
    } catch (err) {
      throw new NonRetryableEmbeddingError('embedding response is not JSON', err);
    }
    const embedding = readEmbedding(data);
    if (!embedding) throw new NonRetryableEmbeddingError('embedding response missing embeddings[0].embedding');
    if (embedding.length !== this.opts.dimension) {
      throw new NonRetryableEmbeddingError('EMBEDDING_DIM_MISMATCH');
    }
    return embedding;
  }
}

function readEmbedding(data: unknown): number[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const output = (data as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) return null;
  const embeddings = (output as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length === 0) return null;
  const first = embeddings[0];
  if (typeof first !== 'object' || first === null) return null;
  const embedding = (first as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding) || !embedding.every((n) => typeof n === 'number')) return null;
  return embedding as number[];
}
