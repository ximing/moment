import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markNotificationsReadSchema, registerPushTokenSchema } from './notifications.js';

test('registerPushTokenSchema 校验 expoToken 长度与 platform 枚举', () => {
  const token = `ExponentPushToken[${'a'.repeat(22)}]`;
  assert.equal(registerPushTokenSchema.parse({ expoToken: token, platform: 'ios' }).platform, 'ios');
  assert.throws(() => registerPushTokenSchema.parse({ expoToken: 'short', platform: 'ios' }));
  assert.throws(() => registerPushTokenSchema.parse({ expoToken: token, platform: 'harmony' }));
});

test('markNotificationsReadSchema：ids 1–100 个 uuid', () => {
  const ids = ['00000000-0000-4000-8000-000000000001'];
  assert.equal(markNotificationsReadSchema.parse({ ids }).ids.length, 1);
  assert.throws(() => markNotificationsReadSchema.parse({ ids: [] }));
  assert.throws(() => markNotificationsReadSchema.parse({ ids: ['not-uuid'] }));
  assert.throws(() =>
    markNotificationsReadSchema.parse({ ids: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })
  );
});
