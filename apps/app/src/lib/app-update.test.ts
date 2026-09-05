import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  apkSizeLabel,
  fetchGithubLatest,
  isNewer,
  localVersionCode,
  parseGithubRelease,
  parseReleaseTag,
  pickApkAsset,
  shouldOfferUpdate,
  versionCodeFromName,
} from './app-update';

describe('versionCodeFromName / parseReleaseTag', () => {
  it('与 CI 同一公式：v0.3.2 → 302', () => {
    assert.equal(versionCodeFromName('0.3.2'), 302);
    assert.equal(parseReleaseTag('v0.3.2')?.versionCode, 302);
    assert.equal(parseReleaseTag('v1.2.3')?.versionCode, 10203);
    assert.equal(parseReleaseTag('v1.2.3')?.versionName, '1.2.3');
  });

  it('拒绝非 semver tag', () => {
    assert.equal(parseReleaseTag('nightly'), null);
    assert.equal(versionCodeFromName('1.2'), null);
  });
});

describe('pickApkAsset / parseGithubRelease', () => {
  it('优先 app-release.apk，没有 APK 则不算可更新', () => {
    assert.equal(pickApkAsset([{ name: 'notes.md', browser_download_url: 'x' }]), null);
    const picked = pickApkAsset([
      { name: 'other.apk', browser_download_url: 'a' },
      { name: 'app-release.apk', browser_download_url: 'b', size: 10 },
    ]);
    assert.equal(picked?.browser_download_url, 'b');
    const remote = parseGithubRelease({
      tag_name: 'v0.4.0',
      assets: [{ name: 'app-release.apk', browser_download_url: 'https://example/app.apk', size: 80_000_000 }],
    });
    assert.deepEqual(remote, {
      versionName: '0.4.0',
      versionCode: 400,
      apkUrl: 'https://example/app.apk',
      apkBytes: 80_000_000,
    });
  });
});

describe('shouldOfferUpdate', () => {
  const remote = {
    versionName: '0.4.0',
    versionCode: 400,
    apkUrl: 'https://example/app.apk',
    apkBytes: 1,
  };

  it('仅 Android 正式包、且远程 versionCode 更大时提示', () => {
    assert.equal(
      shouldOfferUpdate({ platform: 'android', isDev: false, localCode: 302, remote, skippedVersion: null }),
      true,
    );
    assert.equal(
      shouldOfferUpdate({ platform: 'ios', isDev: false, localCode: 302, remote, skippedVersion: null }),
      false,
    );
    assert.equal(
      shouldOfferUpdate({ platform: 'android', isDev: true, localCode: 302, remote, skippedVersion: null }),
      false,
    );
    assert.equal(
      shouldOfferUpdate({ platform: 'android', isDev: false, localCode: 400, remote, skippedVersion: null }),
      false,
    );
  });

  it('用户跳过的同一版本不再提示', () => {
    assert.equal(
      shouldOfferUpdate({
        platform: 'android',
        isDev: false,
        localCode: 302,
        remote,
        skippedVersion: '0.4.0',
      }),
      false,
    );
  });
});

describe('apkSizeLabel', () => {
  it('把字节格式成 MB', () => {
    assert.equal(apkSizeLabel(0), '');
    assert.equal(apkSizeLabel(80_000_000), '约 76 MB');
  });
});

describe('localVersionCode', () => {
  it('优先 android.versionCode，否则从 version 解析', () => {
    assert.equal(localVersionCode({ version: '0.3.2', android: { versionCode: 302 } }), 302);
    assert.equal(localVersionCode({ version: '0.3.2' }), 302);
    assert.equal(localVersionCode({}), 0);
  });
});

describe('fetchGithubLatest', () => {
  it('解析 latest release；404 当没有可更新', async () => {
    const remote = await fetchGithubLatest('ximing/moment', (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v0.4.1',
          assets: [{ name: 'app-release.apk', browser_download_url: 'https://gh/a.apk', size: 2 }],
        }),
        { status: 200 },
      )) as typeof fetch);
    assert.equal(remote?.versionName, '0.4.1');
    assert.equal(remote?.versionCode, 401);

    const missing = await fetchGithubLatest('ximing/moment', (async () =>
      new Response('', { status: 404 })) as typeof fetch);
    assert.equal(missing, null);
  });
});

describe('isNewer', () => {
  it('严格大于才算新', () => {
    assert.equal(isNewer(303, 302), true);
    assert.equal(isNewer(302, 302), false);
    assert.equal(isNewer(301, 302), false);
  });
});
