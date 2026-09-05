/** 与 CI android-release.yml 同一公式：tag vMAJOR.MINOR.PATCH → versionCode。 */
export function versionCodeFromName(versionName: string): number | null {
  const m = versionName.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

export function parseReleaseTag(tag: string): { versionName: string; versionCode: number } | null {
  const m = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const versionName = `${m[1]}.${m[2]}.${m[3]}`;
  return { versionName, versionCode: Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) };
}

export type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
  content_type?: string;
  size?: number;
};

export type GithubRelease = {
  tag_name: string;
  body?: string | null;
  assets?: GithubReleaseAsset[];
};

export type RemoteRelease = {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  apkBytes: number;
};

export function pickApkAsset(assets: GithubReleaseAsset[] | undefined): GithubReleaseAsset | null {
  if (!assets || assets.length === 0) return null;
  const apks = assets.filter((a) => a.name.toLowerCase().endsWith('.apk'));
  if (apks.length === 0) return null;
  return apks.find((a) => a.name === 'app-release.apk') ?? apks[0] ?? null;
}

export function parseGithubRelease(json: GithubRelease): RemoteRelease | null {
  const ver = parseReleaseTag(json.tag_name ?? '');
  const apk = pickApkAsset(json.assets);
  if (!ver || !apk) return null;
  return {
    versionName: ver.versionName,
    versionCode: ver.versionCode,
    apkUrl: apk.browser_download_url,
    apkBytes: typeof apk.size === 'number' ? apk.size : 0,
  };
}

export function isNewer(remoteCode: number, localCode: number): boolean {
  return remoteCode > localCode;
}

export function apkSizeLabel(bytes: number): string {
  if (bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `约 ${rounded} MB`;
}

export function localVersionCode(expoConfig: {
  version?: string;
  android?: { versionCode?: number };
} | null | undefined): number {
  const code = expoConfig?.android?.versionCode;
  if (typeof code === 'number' && Number.isFinite(code) && code > 0) return code;
  return versionCodeFromName(expoConfig?.version ?? '') ?? 0;
}

export function localVersionName(expoConfig: { version?: string } | null | undefined): string {
  return expoConfig?.version ?? '0.0.0';
}

export async function fetchGithubLatest(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<RemoteRelease | null> {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'moment-app',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const json = (await res.json()) as GithubRelease;
  return parseGithubRelease(json);
}

export function shouldOfferUpdate(opts: {
  platform: string;
  isDev: boolean;
  localCode: number;
  remote: RemoteRelease | null;
  skippedVersion: string | null;
}): boolean {
  if (opts.platform !== 'android') return false;
  if (opts.isDev) return false;
  if (!opts.remote) return false;
  if (!isNewer(opts.remote.versionCode, opts.localCode)) return false;
  if (opts.skippedVersion === opts.remote.versionName) return false;
  return true;
}
