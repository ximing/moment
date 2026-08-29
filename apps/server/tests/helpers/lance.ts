import { config } from '../../src/config.js';

export function denseVector(fill = 0.01): number[] {
  return Array.from({ length: config.MULTIMODAL_EMBEDDING_DIMENSION }, () => fill);
}

export const HEX64_A = 'a'.repeat(64);
export const HEX64_B = 'b'.repeat(64);
