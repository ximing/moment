import { INTENT_MAX_QUERY_CHARS, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from '@moment/dto';
import {
  HARD_FILTER_PREFILTER_MAX,
  INTENT_CHAT_MAX_TOKENS,
  INTENT_CHAT_TEMPERATURE,
  INTENT_TIMEOUT_MS,
  VECTOR_CANDIDATE_LIMIT,
} from '../../src/search/constants.js';

describe('search 冻结常量（spec §3.1 / §4.5 / §5）', () => {
  it('超时、窗口、dto 上限', () => {
    expect(INTENT_TIMEOUT_MS).toBe(8000);
    expect(VECTOR_CANDIDATE_LIMIT).toBe(200);
    expect(HARD_FILTER_PREFILTER_MAX).toBe(200);
    expect(INTENT_CHAT_TEMPERATURE).toBe(0);
    expect(INTENT_CHAT_MAX_TOKENS).toBe(512);
    expect(INTENT_MAX_QUERY_CHARS).toBe(500);
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(SEARCH_MAX_LIMIT).toBe(50);
  });
});
