import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { notificationHref } from './notification-href';

describe('notificationHref', () => {
  it('invite.created 打开接受页，不用链页或裸链接', () => {
    assert.equal(
      notificationHref({
        type: 'invite.created',
        payload: { inviteToken: 'tok-1', chainId: 'c-1', title: '邀请你加入「周末」' },
      }),
      '/invites/tok-1',
    );
    assert.equal(
      notificationHref({
        type: 'invite.created',
        payload: { data: { inviteToken: 'tok-2', chainId: 'c-1' } },
      }),
      '/invites/tok-2',
    );
  });

  it('时刻 / 链通知仍走原路径', () => {
    assert.equal(
      notificationHref({ type: 'moment.created', payload: { momentId: 'm-1', chainId: 'c-1' } }),
      '/moments/m-1',
    );
    assert.equal(notificationHref({ type: 'comment.created', payload: { chainId: 'c-9' } }), '/chains/c-9');
  });
});
