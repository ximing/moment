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
  draft?: boolean;
  prerelease?: boolean;
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
  if (json.draft === true || json.prerelease === true) return null;
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

/** 缓存里的安装包文件名。同一 versionName 复用，避免重复下载。 */
export function updateApkFileName(versionName: string): string {
  return `moment-${versionName}.apk`;
}

/** expectedBytes 为 0 时只要求文件非空（GitHub 没给 size）。否则必须与发布资源字节数一致。 */
export function isApkDownloadComplete(actualBytes: number, expectedBytes: number): boolean {
  if (actualBytes <= 0) return false;
  if (expectedBytes <= 0) return true;
  return actualBytes === expectedBytes;
}

export function apkSizeLabel(bytes: number): string {
  if (bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `约 ${rounded} MB`;
}

/** 下载进度。总量未知时返回空串。 */
export function downloadProgressLabel(downloaded: number, total: number): string {
  if (!(total > 0) || !Number.isFinite(downloaded)) return '';
  const pct = Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  return `${pct}%`;
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

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'moment-app',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function readGithubJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function releaseFromUnknown(body: unknown): RemoteRelease | null {
  if (!body || typeof body !== 'object') return null;
  return parseGithubRelease(body as GithubRelease);
}

/**
 * 直接读 GitHub Releases。latest 没有正式 APK（例如只有桌面安装包、或是草稿）时，
 * 沿最近 10 条发布找第一份 app-release.apk。安装包地址用资源的 browser_download_url。
 */
export async function fetchGithubLatest(
  repo: string,
  fetchFn: typeof fetch = fetch,
): Promise<RemoteRelease | null> {
  const latestRes = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: GITHUB_HEADERS,
  });
  const latestBody = latestRes.ok ? await readGithubJson(latestRes) : null;
  const latest = releaseFromUnknown(latestBody);
  if (latest) return latest;

  const listRes = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
    headers: GITHUB_HEADERS,
  });
  if (listRes.ok) {
    const listBody = await readGithubJson(listRes);
    if (Array.isArray(listBody)) {
      for (const item of listBody) {
        const release = releaseFromUnknown(item);
        if (release) return release;
      }
    }
  }

  if (latestRes.status === 404 || listRes.status === 404) return null;
  const status = latestRes.ok ? listRes.status : latestRes.status;
  if (status >= 400) throw new Error(`GitHub ${status}`);
  return null;
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
