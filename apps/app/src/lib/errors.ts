import { ApiError } from '@moment/api-client';

const COPY: Record<string, string> = {
  INVALID_CREDENTIALS: '邮箱或密码不对',
  INVALID_OLD_PASSWORD: '旧密码不对',
  EMAIL_ALREADY_REGISTERED: '该邮箱已注册',
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
  TAG_EXISTS: '标签已存在',
  TAG_LIMIT_REACHED: '标签已达上限 100 个',
  INVITE_NOT_FOUND: '邀请不存在或已被吊销',
  INVITE_EXPIRED: '邀请已过期',
  INVITE_ALREADY_ACCEPTED: '邀请已被使用',
  INVITE_EMAIL_MISMATCH: '该邀请限定了其他邮箱',
  MOMENT_NOT_FOUND: '该时刻可能已被删除',
  MOMENT_DELETED: '该时刻可能已被删除',
  NETWORK_ERROR: '网络不太好，请重试',
  EMPTY_PATCH: '没有要保存的修改',
  CONTENT_REQUIRED: '先写一句此刻吧',
  MEDIA_COUNT_INVALID: '图片或视频数量不对',
};

const FALLBACK = '出了点问题，请重试';

export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
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
