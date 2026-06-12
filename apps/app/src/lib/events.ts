// lib/events.ts —— 全局事件 payload 契约（spec §5 事件表；发射与监听双方都从这里 import）。
// 注：auth:changed 的 payload 直接用 `UserProfile | null`（@moment/dto），不另设类型。

export type MomentChangedPayload = {
  momentId: string;
  chainId: string;
  op: 'create' | 'update' | 'delete' | 'react';
};
export type CommentChangedPayload = { momentId: string };
export type ChainChangedPayload = { chainId: string; op: 'create' | 'update' | 'delete' };
