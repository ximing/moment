/** getObject 超 maxBytes（spec fused-retrieval §2.4）。P3 再包装为 NonRetryableCompressError。 */
export class ObjectTooLargeError extends Error {
  readonly key: string;
  readonly maxBytes: number;
  constructor(key: string, maxBytes: number) {
    super('OBJECT_TOO_LARGE');
    this.name = 'ObjectTooLargeError';
    this.key = key;
    this.maxBytes = maxBytes;
  }
}

/** 中止 SDK 流，避免超限后仍把对象读完。无 destroy 则 no-op。 */
export function abortS3Body(body: unknown): void {
  if (body && typeof body === 'object' && 'destroy' in body && typeof (body as { destroy: unknown }).destroy === 'function') {
    (body as { destroy: (err?: Error) => void }).destroy();
  }
}

/**
 * 有界拼接。总长 > maxBytes 时抛 ObjectTooLargeError 并 abort。
 * 不得改用 transformToByteArray（无界）。
 */
export async function readBodyWithLimit(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  key: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        abortS3Body(body);
        throw new ObjectTooLargeError(key, maxBytes);
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (err) {
    abortS3Body(body);
    throw err;
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total);
}
