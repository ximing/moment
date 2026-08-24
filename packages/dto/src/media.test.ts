import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_MIME_TYPES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaCompleteInputSchema,
  mediaPartsInputSchema,
  mediaPresignInputSchema,
} from './media.js';

test('媒体大小常量符合 spec §5.5', () => {
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_VIDEO_BYTES, 500 * 1024 * 1024);
});

test('mediaPresignInputSchema：kind 与 mime 白名单必须匹配', () => {
  assert.ok(mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'image' }).success);
  assert.ok(mediaPresignInputSchema.safeParse({ mime: 'video/webm', size: 1000, kind: 'video' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'video/mp4', size: 1000, kind: 'image' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'application/pdf', size: 1000, kind: 'image' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'video/x-ms-wmv', size: 1000, kind: 'video' }).success);
});

test('mediaPresignInputSchema：image/svg+xml 一律拒绝（存储型 XSS 防线）', () => {
  // SVG 可内嵌 <script>：若放行，预签名 GET 会以 image/svg+xml 原样下发，viewer 浏览器打开即执行任意 JS
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'image/svg+xml', size: 1000, kind: 'image' }).success);
});

test('mediaPresignInputSchema：size 必须正整数', () => {
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'image/png', size: 0, kind: 'image' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'image/png', size: 1.5, kind: 'image' }).success);
});

test('mediaPresignInputSchema：durationSeconds 可选、≤300、仅 video 可携带（spec §5.5 ≤5 分钟）', () => {
  assert.ok(
    mediaPresignInputSchema.safeParse({ mime: 'video/mp4', size: 1000, kind: 'video', durationSeconds: 300 }).success
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'video/mp4', size: 1000, kind: 'video', durationSeconds: 301 }).success
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'image', durationSeconds: 60 }).success
  );
});

test('mediaPartsInputSchema：partNumbers 非空、1..10000、最多 200 个', () => {
  assert.ok(mediaPartsInputSchema.safeParse({ partNumbers: [1, 2, 3] }).success);
  assert.ok(!mediaPartsInputSchema.safeParse({ partNumbers: [] }).success);
  assert.ok(!mediaPartsInputSchema.safeParse({ partNumbers: [0] }).success);
  assert.ok(!mediaPartsInputSchema.safeParse({ partNumbers: Array.from({ length: 201 }, (_, i) => i + 1) }).success);
});

test('mediaCompleteInputSchema：parts 缺省为空数组（图片 PUT 复用同一 schema）', () => {
  assert.deepEqual(mediaCompleteInputSchema.parse({}), { parts: [] });
  const parsed = mediaCompleteInputSchema.parse({ parts: [{ partNumber: 1, etag: '"abc"' }] });
  assert.equal(parsed.parts[0]?.etag, '"abc"');
});

test('audio 常量：25MB / 300s / 白名单 6 项（spec voice-moment §2.1）', () => {
  assert.equal(MAX_AUDIO_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_AUDIO_DURATION_SECONDS, 300);
  assert.deepEqual([...AUDIO_MIME_TYPES], [
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
  ]);
});

test('mediaPresignInputSchema：kind=audio 白名单 mime + durationSeconds 必填 ≤300', () => {
  assert.ok(
    mediaPresignInputSchema.safeParse({ mime: 'audio/wav', size: 1000, kind: 'audio', durationSeconds: 60 }).success,
  );
  assert.ok(
    mediaPresignInputSchema.safeParse({ mime: 'audio/mp4', size: 1000, kind: 'audio', durationSeconds: 300 }).success,
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'audio/webm', size: 1000, kind: 'audio', durationSeconds: 60 }).success,
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'audio/ogg', size: 1000, kind: 'audio', durationSeconds: 60 }).success,
  );
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'audio/wav', size: 1000, kind: 'audio' }).success);
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'audio/wav', size: 1000, kind: 'audio', durationSeconds: 301 }).success,
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'audio', durationSeconds: 60 }).success,
  );
});

test('mediaPresignInputSchema：image 分支既有校验不回归（禁传 durationSeconds）', () => {
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'image', durationSeconds: 60 }).success,
  );
});
