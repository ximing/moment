import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSseParser } from './sse.js';

test('SSE 解析跨分片，忽略注释，丢掉未知事件和坏 JSON', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push(': ok\n\n'), []);
  assert.deepEqual(parser.push('event: token\n'), []);
  assert.deepEqual(parser.push('data: {"text":"你"}\n\n'), [{ event: 'token', data: { text: '你' } }]);

  const batched = parser.push(
    [
      'event: status',
      'data: {"phase":"thinking"}',
      '',
      ': keep-alive',
      '',
      'event: ping',
      'data: {"ok":true}',
      '',
      'event: token',
      'data: {nope}',
      '',
      'event: done',
      'data: {"message":null,"thread":null}',
      '',
      '',
    ].join('\n'),
  );
  assert.deepEqual(batched, [
    { event: 'status', data: { phase: 'thinking' } },
    { event: 'done', data: { message: null, thread: null } },
  ]);
});

test('SSE 分片落在 \\r\\n 边界仍能拼回事件', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: token\r\ndata: {"text":"甲"}\r'), []);
  assert.deepEqual(parser.push('\n\r\n'), [{ event: 'token', data: { text: '甲' } }]);
});
