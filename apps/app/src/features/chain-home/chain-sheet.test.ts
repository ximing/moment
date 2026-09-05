import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { chainSheetItems, chainSheetTitle } from './chain-sheet';

describe('chainSheetItems', () => {
  it('owner 露出分享 / 成员 / 人物 / 标签 / 设置 / 处理中', () => {
    assert.deepEqual(
      chainSheetItems('owner').map((i) => i.label),
      ['分享', '成员', '人物', '标签', '设置', '处理中'],
    );
  });

  it('editor 没有分享和处理中', () => {
    assert.deepEqual(
      chainSheetItems('editor').map((i) => i.label),
      ['成员', '人物', '标签', '设置'],
    );
  });

  it('viewer 只有成员和设置', () => {
    assert.deepEqual(
      chainSheetItems('viewer').map((i) => i.label),
      ['成员', '设置'],
    );
  });
});

describe('chainSheetTitle', () => {
  it('把 section 映射成页标题', () => {
    assert.equal(chainSheetTitle('share'), '分享');
    assert.equal(chainSheetTitle('profile'), '设置');
    assert.equal(chainSheetTitle(undefined), '这条链');
  });
});
