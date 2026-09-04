import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  TOAST_ACTIONABLE_MS,
  TOAST_MAX_QUEUED,
  TOAST_NORMAL_MS,
  emptyToastState,
  reduceToastClear,
  reduceToastPromote,
  reduceToastShow,
  toastDuration,
  type ToastItem,
} from './toast-queue';

const plain = (key: string, message = key): ToastItem => ({ key, message });
const undo = (key: string): ToastItem => ({
  key,
  message: key,
  action: { label: '撤销', onPress: () => undefined },
});

describe('toastDuration', () => {
  it('普通 3500ms，带动作 6000ms', () => {
    assert.equal(toastDuration(plain('a')), TOAST_NORMAL_MS);
    assert.equal(toastDuration(undo('a')), TOAST_ACTIONABLE_MS);
  });
});

describe('reduceToastShow', () => {
  it('空槽直接上位', () => {
    const next = reduceToastShow(emptyToastState(), plain('a', '已发布'));
    assert.equal(next.visible?.message, '已发布');
    assert.equal(next.queue.length, 0);
  });

  it('同 key 替换可见条，不进队列', () => {
    const s = reduceToastShow(emptyToastState(), plain('error', '失败 1'));
    const next = reduceToastShow(s, plain('error', '失败 2'));
    assert.equal(next.visible?.message, '失败 2');
    assert.equal(next.queue.length, 0);
  });

  it('同 key 替换等待条', () => {
    let s = reduceToastShow(emptyToastState(), plain('a'));
    s = reduceToastShow(s, plain('b', '旧'));
    s = reduceToastShow(s, plain('b', '新'));
    assert.equal(s.visible?.key, 'a');
    assert.equal(s.queue[0]?.message, '新');
  });

  it('一显二候；满员驱逐最老的普通确认，不驱逐可撤销', () => {
    let s = reduceToastShow(emptyToastState(), plain('a'));
    s = reduceToastShow(s, plain('b'));
    s = reduceToastShow(s, plain('c'));
    assert.equal(s.visible?.key, 'a');
    assert.equal(s.queue.length, TOAST_MAX_QUEUED);
    assert.deepEqual(
      s.queue.map((t) => t.key),
      ['b', 'c'],
    );

    s = reduceToastShow(s, plain('d'));
    assert.deepEqual(
      s.queue.map((t) => t.key),
      ['c', 'd'],
    );

    let guarded = reduceToastShow(emptyToastState(), plain('a'));
    guarded = reduceToastShow(guarded, undo('u1'));
    guarded = reduceToastShow(guarded, undo('u2'));
    const blocked = reduceToastShow(guarded, plain('x'));
    assert.deepEqual(
      blocked.queue.map((t) => t.key),
      ['u1', 'u2'],
    );
  });
});

describe('reduceToastPromote / clear', () => {
  it('晋级等待条；清空同步拆掉可见与队列', () => {
    let s = reduceToastShow(emptyToastState(), plain('a'));
    s = reduceToastShow(s, plain('b'));
    s = reduceToastPromote(s);
    assert.equal(s.visible?.key, 'b');
    assert.equal(s.queue.length, 0);
    s = reduceToastClear();
    assert.equal(s.visible, null);
    assert.equal(s.queue.length, 0);
  });
});
