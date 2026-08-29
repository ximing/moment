import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reverseGeocodeInputSchema } from './geocode.js';

test('reverseGeocodeInputSchema：合法 WGS-84 通过；越界 / 缺键 / 未知键拒绝', () => {
  assert.deepEqual(reverseGeocodeInputSchema.parse({ lat: 39.9042, lng: 116.4074 }), {
    lat: 39.9042,
    lng: 116.4074,
  });
  assert.throws(() => reverseGeocodeInputSchema.parse({ lat: 91, lng: 0 }));
  assert.throws(() => reverseGeocodeInputSchema.parse({ lat: 0, lng: 181 }));
  assert.throws(() => reverseGeocodeInputSchema.parse({ lat: 0 }));
  assert.throws(() => reverseGeocodeInputSchema.parse({ lat: 0, lng: 0, source: 'exif' }));
});
