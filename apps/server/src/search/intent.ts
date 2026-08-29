import type { SearchParsed } from '@moment/dto';
import { RetryableLLMError } from '../llm/base.provider.js';
import { getLLMProvider } from '../llm/factory.js';
import { logger } from '../utils/logger.js';
import {
  INTENT_CHAT_MAX_TOKENS,
  INTENT_CHAT_TEMPERATURE,
  INTENT_TIMEOUT_MS,
} from './constants.js';
import { degradedParsed, parseIntentJson, viewerWallDate } from './parse-intent.js';
import { buildIntentSystemPrompt, buildIntentUserPrompt } from './prompt.js';

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RetryableLLMError('INTENT_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function parseSearchIntent(
  q: string,
  tzOffset: number,
  nowMs: number = Date.now(),
): Promise<SearchParsed> {
  const provider = getLLMProvider();
  if (provider === null) return degradedParsed(q);

  const viewerDate = viewerWallDate(tzOffset, nowMs);
  try {
    const resp = await withTimeout(
      provider.chat({
        messages: [
          { role: 'system', content: buildIntentSystemPrompt() },
          { role: 'user', content: buildIntentUserPrompt(q, viewerDate, tzOffset) },
        ],
        temperature: INTENT_CHAT_TEMPERATURE,
        maxTokens: INTENT_CHAT_MAX_TOKENS,
      }),
      INTENT_TIMEOUT_MS,
    );
    const parsed = parseIntentJson(resp.content);
    if (parsed === null) {
      logger.warn('search intent json malformed');
      return degradedParsed(q);
    }
    return parsed;
  } catch (err) {
    logger.warn('search intent degraded', err);
    return degradedParsed(q);
  }
}
