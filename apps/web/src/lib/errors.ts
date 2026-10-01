import { ApiError } from '@moment/api-client';

const COPY: Record<string, string> = {
  INVALID_CREDENTIALS: '邮箱或密码不对',
  UNAUTHORIZED: '登录过期了，请重新登录',
  CHAIN_NOT_FOUND: '看不到这条链，或它已经不在了',
  CHAIN_ROLE_INSUFFICIENT: '没有权限做这件事',
  SHARE_NOT_FOUND: '这本相册的分享已关闭',
  SHARE_LINK_NOT_FOUND: '这条分享链接不存在',
  MEDIA_NOT_FOUND: '看不到这张图或视频',
  MEDIA_TOO_LARGE: '文件太大',
  VALIDATION_ERROR: '有些内容需要改一改',
  RATE_LIMITED: '操作太频繁，请稍后再试',
  OWNER_MUST_TRANSFER: '创建者离开前需要先把链交给别人',
  CANNOT_TRANSFER_TO_SELF: '不能转让给自己',
  CANNOT_CHANGE_OWN_ROLE: '不能改自己的角色',
  MEMBER_NOT_FOUND: '这个人已经不在链里',
  TAG_NOT_IN_CHAIN: '这个标签不属于这条链',
  PERSON_NOT_IN_CHAIN: '这个人物不属于这条链',
  PERSON_NAME_CONFLICT: '已经有同名的人物了',
  PERSON_NOT_FOUND: '这个人已经不在了',
  PERSON_USER_NOT_IN_CHAIN: '这位家人不在链里',
  NETWORK_ERROR: '网络不太好，请重试',
  EMPTY_PATCH: '没有要保存的修改',
  CONTENT_REQUIRED: '先写一句此刻吧',
  MEDIA_COUNT_INVALID: '图片或视频数量不对',
  MEDIA_INVALID: '这些图片不能用，请重新选择',
  MEDIA_NOT_ALLOWED: '这种时刻不能改媒体',
  MOMENT_PAYLOAD_INVALID: '结构化内容和这条链的模板对不上',
};

const FIELD_HINT: Record<string, string> = {
  content: '正文需要改一下',
  tagIds: '标签需要重新选',
  personIds: '人物需要重新选',
  place: '地点需要改一下',
  kind: '结构化内容需要改一下',
  payload: '结构化内容需要改一下',
  happenedAt: '发生时间不对',
  happenedTzOffset: '发生时间不对',
  isBackfill: '发生时间不对',
  mediaIds: '图片或视频需要重新选',
  posterMediaId: '封面需要重新选',
  chainId: '要换去的链不对',
};

const CHAIN_MOVE_UNAVAILABLE = '换链这一步线上服务还没更新，时刻先留在原来的链上';

const FALLBACK = '出了点问题，请重试';

/** 服务端 zod issues。换链在旧服务端是 unrecognized chainId，其余按字段给一句能照着改的话。 */
function validationHint(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const hints: string[] = [];
  for (const raw of details) {
    if (!raw || typeof raw !== 'object') continue;
    const issue = raw as { code?: string; message?: string; path?: unknown; keys?: unknown };
    const keys = Array.isArray(issue.keys) ? issue.keys.filter((key): key is string => typeof key === 'string') : [];
    if (issue.code === 'unrecognized_keys' && keys.includes('chainId')) {
      hints.push(CHAIN_MOVE_UNAVAILABLE);
      continue;
    }
    if (typeof issue.message === 'string' && COPY[issue.message]) {
      hints.push(COPY[issue.message]);
      continue;
    }
    const head = Array.isArray(issue.path) ? issue.path[0] : undefined;
    if (typeof head === 'string' && FIELD_HINT[head]) hints.push(FIELD_HINT[head]);
  }
  const unique = [...new Set(hints)];
  return unique.length > 0 ? unique.join('；') : null;
}

export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR') return validationHint(err.details) ?? COPY.VALIDATION_ERROR;
    if (COPY[err.code]) return COPY[err.code];
    if (COPY[err.message]) return COPY[err.message];
    if (err.status === 401) return COPY.UNAUTHORIZED;
    return FALLBACK;
  }
  if (err instanceof Error && err.message) {
    return COPY[err.message] ?? FALLBACK;
  }
  return FALLBACK;
}
