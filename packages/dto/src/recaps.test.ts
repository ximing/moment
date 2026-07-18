import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RECAP_STATUSES,
  periodSchema,
  recapStatusSchema,
  type RecapDto,
  type RecapListResponse,
  type PublicShareRecap,
} from './recaps.js';

test('RECAP_STATUSES：四个状态值锁定', () => {
  assert.deepEqual([...RECAP_STATUSES], ['generating', 'ready', 'failed', 'degraded']);
});

test('recapStatusSchema：合法值通过、词表外拒绝', () => {
  assert.equal(recapStatusSchema.parse('generating'), 'generating');
  assert.equal(recapStatusSchema.parse('ready'), 'ready');
  assert.equal(recapStatusSchema.parse('failed'), 'failed');
  assert.equal(recapStatusSchema.parse('degraded'), 'degraded');
  assert.throws(() => recapStatusSchema.parse('pending'));
  assert.throws(() => recapStatusSchema.parse('success'));
});

test('periodSchema：YYYY-MM 合法、边界月与格式非法拒绝', () => {
  assert.equal(periodSchema.parse('2026-01'), '2026-01');
  assert.equal(periodSchema.parse('2026-12'), '2026-12');
  assert.equal(periodSchema.parse('1999-06'), '1999-06');
  // 边界月：01 与 12 合法
  assert.equal(periodSchema.parse('2026-12'), '2026-12');
  assert.throws(() => periodSchema.parse('2026-13')); // 月 13 非法
  assert.throws(() => periodSchema.parse('2026-00')); // 月 00 非法
  assert.throws(() => periodSchema.parse('2026-1'));  // 补零要求
  assert.throws(() => periodSchema.parse('202601'));  // 缺横线
  assert.throws(() => periodSchema.parse('2026/01')); // 斜杠分隔
  assert.throws(() => periodSchema.parse('abcd-ef')); // 非数字
  assert.throws(() => periodSchema.parse(''));        // 空串
});

test('RecapDto 类型可赋值：含全字段（highlights 为 string[]，非 number[]）', () => {
  const dto: RecapDto = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'ready',
    content: '## 7月回顾\n本月记录了10条时刻…',
    highlights: ['moment-uuid-1', 'moment-uuid-2'],
    model: 'deepseek-chat',
    promptVersion: 1,
    tokenUsage: { prompt: 1200, completion: 800, total: 2000 },
    error: null,
    generatedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  };
  assert.equal(dto.status, 'ready');
  assert.equal(dto.highlights.length, 2);
  assert.equal(dto.tokenUsage!.total, 2000);
});

test('RecapDto：failed 状态时 model/tokenUsage/generatedAt 可为 null', () => {
  const dto: RecapDto = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'failed',
    content: '',
    highlights: [],
    model: null,
    promptVersion: 1,
    tokenUsage: null,
    error: 'LLM_TIMEOUT',
    generatedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:10:00.000Z',
  };
  assert.equal(dto.status, 'failed');
  assert.equal(dto.model, null);
  assert.equal(dto.tokenUsage, null);
  assert.equal(dto.generatedAt, null);
});

test('RecapDto：degraded 状态（预算降级）model 为 null、tokenUsage 为 null', () => {
  const dto: RecapDto = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'degraded',
    content: '本月记录 8 条，里程碑：第一次微笑。',
    highlights: ['moment-uuid-1'],
    model: null,
    promptVersion: 1,
    tokenUsage: null,
    error: null,
    generatedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  };
  assert.equal(dto.status, 'degraded');
  assert.equal(dto.model, null);
  assert.equal(dto.tokenUsage, null);
});

test('RecapListResponse：recaps 数组可空', () => {
  const res: RecapListResponse = { recaps: [] };
  assert.equal(res.recaps.length, 0);
});

test('PublicShareRecap 可赋值为 RecapDto（字段子集复用）', () => {
  const recap: PublicShareRecap = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'ready',
    content: 'markdown',
    highlights: [],
    model: 'deepseek-chat',
    promptVersion: 1,
    tokenUsage: null,
    error: null,
    generatedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  };
  assert.equal(recap.period, '2026-07');
});
