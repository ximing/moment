import type {
  AcceptInviteResponse,
  AuthResponse,
  ChainDto,
  ChainMemberDto,
  CommentDto,
  CommentListResponse,
  CreateChainInput,
  CreateInviteInput,
  CreateShareLinkInput,
  FeedResponse,
  InviteDto,
  InviteRole,
  LoginInput,
  MediaCompleteResponse,
  MediaPartsResponse,
  MediaPresignInput,
  MediaPresignResponse,
  MomentResponse,
  NotificationListResponse,
  PatchMomentInput, // 等价映射（依赖契约段免责条款）：Phase 3 计划名 PatchMomentInput / Phase 4 计划名 UpdateMomentInput——若 dto 实际导出为 UpdateMomentInput，改为 `UpdateMomentInput as PatchMomentInput`，禁止反向改 dto
  PublicShareResponse,
  RegisterInput,
  RegisterPushTokenInput,
  ShareLinkDto,
  ShareLinkListResponse,
  TagListResponse,
  TagResponse,
  UpdateChainInput,
  UserProfile,
} from '@moment/dto';
import { createMomentInputSchema } from '@moment/dto';
import type { ZodInput } from './zod-input.js';
import { Http } from './http.js';
import type { MomentClientOptions } from './types.js';
import { uploadMediaImpl, type UploadMediaInput } from './upload.js';

/** feed 查询（web 端 camelCase，序列化时转 snake_case 查询参数，Phase 4 dto 约定） */
export interface FeedQuery {
  cursor?: string;
  chainIds?: string[];
  tagId?: string;
  order?: 'happened_at' | 'created_at';
  limit?: number;
}

/** moment 创建入参：z.input 形态（isBackfill/mediaIds/tagIds 可省略，dto schema 补默认值） */
export type CreateMomentInput = ZodInput<typeof createMomentInputSchema>;

export interface MomentClient {
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<UserProfile>;

  listChains(): Promise<ChainDto[]>;
  getChain(chainId: string): Promise<ChainDto>;
  createChain(input: CreateChainInput): Promise<ChainDto>;
  updateChain(chainId: string, input: UpdateChainInput): Promise<ChainDto>;
  deleteChain(chainId: string): Promise<void>;
  listMembers(chainId: string): Promise<ChainMemberDto[]>;
  updateMemberRole(chainId: string, userId: string, role: InviteRole): Promise<ChainMemberDto>;
  removeMember(chainId: string, userId: string): Promise<void>;
  transferChain(chainId: string, userId: string): Promise<ChainDto>;
  createInvite(chainId: string, input: CreateInviteInput): Promise<InviteDto>;
  listInvites(chainId: string): Promise<InviteDto[]>;
  revokeInvite(inviteId: string): Promise<void>;
  acceptInvite(token: string): Promise<AcceptInviteResponse>;

  createMoment(chainId: string, input: CreateMomentInput): Promise<MomentResponse>;
  /** Phase 5 后 service 返回 {moments, nextCursor}，但 dto 的 MomentListResponse 仍是 Phase 3 的 items 键——统一用 Pick<FeedResponse>（见依赖契约段） */
  listChainMoments(chainId: string, query?: { cursor?: string; limit?: number }): Promise<Pick<FeedResponse, 'moments' | 'nextCursor'>>;
  getMoment(momentId: string): Promise<MomentResponse>;
  updateMoment(momentId: string, input: PatchMomentInput): Promise<MomentResponse>;
  deleteMoment(momentId: string): Promise<void>;
  getFeed(query?: FeedQuery): Promise<FeedResponse>;

  listTags(chainId: string): Promise<TagListResponse>;
  createTag(chainId: string, name: string): Promise<TagResponse>;
  deleteTag(tagId: string): Promise<void>;

  presignMedia(input: MediaPresignInput): Promise<MediaPresignResponse>;
  presignMediaParts(mediaId: string, partNumbers: number[]): Promise<MediaPartsResponse>;
  completeMedia(mediaId: string, parts: { partNumber: number; etag: string }[]): Promise<MediaCompleteResponse>;
  abortMedia(mediaId: string): Promise<void>;
  mediaUrl(mediaId: string): string;
  /** Web `<img>/<video>` 渲染的唯一来源：Blob → URL.createObjectURL（见 Global Constraints 媒体条目） */
  fetchMediaBlob(mediaId: string): Promise<Blob>;

  // share links & public
  createShareLink(chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto>;
  listShareLinks(chainId: string): Promise<ShareLinkListResponse>;
  revokeShareLink(shareLinkId: string): Promise<void>;
  getPublicShare(token: string, cursor?: string): Promise<PublicShareResponse>;

  listComments(momentId: string, query?: { cursor?: string; limit?: number }): Promise<CommentListResponse>;
  createComment(momentId: string, content: string): Promise<CommentDto>;
  deleteComment(commentId: string): Promise<void>;
  /** Phase 5：PUT/DELETE 均 204 空 body——调用方成功后 invalidate moment/feed 重新 GET */
  setReaction(momentId: string, emoji: string): Promise<void>;
  removeReaction(momentId: string): Promise<void>;

  /** 分页参数：页面消费一律 limit: 50（服务端默认每页仅 20，见依赖契约段）；cursor 供「全部已读」循环翻页收集全部未读 */
  listNotifications(unread?: boolean, query?: { cursor?: string; limit?: number }): Promise<NotificationListResponse>;
  /** Phase 5 schema：ids 必填 1–100 个 uuid（无「空=全部」语义，分批由调用方负责） */
  markNotificationsRead(ids: string[]): Promise<void>;
  registerPushToken(input: RegisterPushTokenInput): Promise<void>;
  uploadMedia(input: UploadMediaInput): Promise<MediaCompleteResponse>;
}

export function createMomentClient(options: MomentClientOptions): MomentClient {
  const http = new Http(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  /** 入参先过 dto schema 补默认值（isBackfill:false、mediaIds:[]、tagIds 不传时 strip），保证请求体与测试断言一致 */
  const parseMomentInput = (input: CreateMomentInput): Record<string, unknown> =>
    createMomentInputSchema.parse(input) as unknown as Record<string, unknown>;

  return {
    register: (input) => http.request('/api/auth/register', { method: 'POST', body: input, skipAuthRefresh: true }),
    login: (input) => http.request('/api/auth/login', { method: 'POST', body: input, skipAuthRefresh: true }),
    logout: (refreshToken) =>
      http.request('/api/auth/logout', { method: 'POST', body: { refreshToken }, skipAuthRefresh: true }),
    me: () => http.request('/api/auth/me'),

    listChains: () => http.request('/api/chains'),
    getChain: (chainId) => http.request(`/api/chains/${chainId}`),
    createChain: (input) => http.request('/api/chains', { method: 'POST', body: input }),
    updateChain: (chainId, input) => http.request(`/api/chains/${chainId}`, { method: 'PATCH', body: input }),
    deleteChain: (chainId) => http.request(`/api/chains/${chainId}`, { method: 'DELETE' }),
    listMembers: (chainId) => http.request(`/api/chains/${chainId}/members`),
    updateMemberRole: (chainId, userId, role) =>
      http.request(`/api/chains/${chainId}/members/${userId}`, { method: 'PATCH', body: { role } }),
    removeMember: (chainId, userId) =>
      http.request(`/api/chains/${chainId}/members/${userId}`, { method: 'DELETE' }),
    transferChain: (chainId, userId) =>
      http.request(`/api/chains/${chainId}/transfer`, { method: 'POST', body: { userId } }),
    createInvite: (chainId, input) => http.request(`/api/chains/${chainId}/invites`, { method: 'POST', body: input }),
    listInvites: (chainId) => http.request(`/api/chains/${chainId}/invites`),
    revokeInvite: (inviteId) => http.request(`/api/invites/${inviteId}`, { method: 'DELETE' }),
    acceptInvite: (token) => http.request(`/api/invites/${token}/accept`, { method: 'POST' }),

    createMoment: (chainId, input) =>
      http.request(`/api/chains/${chainId}/moments`, { method: 'POST', body: parseMomentInput(input) }),
    // 等价映射 dto MomentListResponse.items → FeedResponse.moments，禁止改 server
    listChainMoments: async (chainId, query) => {
      const res = await http.request<{
        items?: import('@moment/dto').MomentResponse[];
        moments?: import('@moment/dto').MomentResponse[];
        nextCursor: string | null;
      }>(`/api/chains/${chainId}/moments`, { query: { cursor: query?.cursor, limit: query?.limit } });
      return { moments: res.moments ?? res.items ?? [], nextCursor: res.nextCursor ?? null };
    },
    getMoment: (momentId) => http.request(`/api/moments/${momentId}`),
    updateMoment: (momentId, input) => http.request(`/api/moments/${momentId}`, { method: 'PATCH', body: input }),
    deleteMoment: (momentId) => http.request(`/api/moments/${momentId}`, { method: 'DELETE' }),
    getFeed: (query) =>
      http.request('/api/feed', {
        query: {
          cursor: query?.cursor,
          chain_ids: query?.chainIds?.join(','),
          tag_id: query?.tagId,
          order: query?.order,
          limit: query?.limit,
        },
      }),

    listTags: (chainId) => http.request(`/api/chains/${chainId}/tags`),
    createTag: (chainId, name) => http.request(`/api/chains/${chainId}/tags`, { method: 'POST', body: { name } }),
    deleteTag: (tagId) => http.request(`/api/tags/${tagId}`, { method: 'DELETE' }),

    presignMedia: (input) => http.request('/api/media/presign', { method: 'POST', body: input }),
    presignMediaParts: (mediaId, partNumbers) =>
      http.request(`/api/media/${mediaId}/parts`, { method: 'POST', body: { partNumbers } }),
    completeMedia: (mediaId, parts) =>
      http.request(`/api/media/${mediaId}/complete`, { method: 'POST', body: { parts } }),
    abortMedia: (mediaId) => http.request(`/api/media/${mediaId}/abort`, { method: 'POST' }),
    mediaUrl: (mediaId) => `${baseUrl}/api/media/${mediaId}`,
    fetchMediaBlob: (mediaId) => http.requestBlob(`/api/media/${mediaId}`),

    listComments: (momentId, query) =>
      http.request(`/api/moments/${momentId}/comments`, { query: { cursor: query?.cursor, limit: query?.limit } }),
    createComment: (momentId, content) =>
      http.request(`/api/moments/${momentId}/comments`, { method: 'POST', body: { content } }),
    deleteComment: (commentId) => http.request(`/api/comments/${commentId}`, { method: 'DELETE' }),
    setReaction: (momentId, emoji) =>
      http.request(`/api/moments/${momentId}/reaction`, { method: 'PUT', body: { emoji } }),
    removeReaction: (momentId) => http.request(`/api/moments/${momentId}/reaction`, { method: 'DELETE' }),

    listNotifications: (unread, query) =>
      http.request('/api/notifications', {
        query: {
          unread: unread === undefined ? undefined : unread ? 'true' : 'false',
          cursor: query?.cursor,
          limit: query?.limit,
        },
      }),
    markNotificationsRead: (ids) => http.request('/api/notifications/read', { method: 'POST', body: { ids } }),
    registerPushToken: (input) => http.request('/api/devices/push-token', { method: 'POST', body: input }),
    uploadMedia: (input) => uploadMediaImpl(http, options, input),
    createShareLink: (chainId, input) =>
      http.request<ShareLinkDto>(`/api/chains/${chainId}/share-links`, { method: 'POST', body: input }),
    listShareLinks: (chainId) => http.request<ShareLinkListResponse>(`/api/chains/${chainId}/share-links`),
    revokeShareLink: (shareLinkId) =>
      http.request<void>(`/api/share-links/${shareLinkId}`, { method: 'DELETE' }),
    getPublicShare: (token, cursor) =>
      http.request<PublicShareResponse>(`/api/public/share/${token}`, {
        query: { cursor },
        skipAuth: true, // 匿名可用；永不触发 refresh
      }),
  };
}
