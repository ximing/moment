export interface PushMessage {
  /** Expo push token（ExponentPushToken[...]） */
  to: string;
  title: string;
  body: string;
  /** 客户端路由用（momentId 等） */
  data?: Record<string, unknown>;
}

/** send 结果：需要失效（DeviceNotRegistered）的 token 列表，落库由调用方完成。 */
export interface PushSendOutcome {
  invalidTokens: string[];
}

/** 推送出口（CONVENTIONS §4：外部服务 mock 注入点）。实现不得触 DB。 */
export interface PushService {
  send(messages: PushMessage[]): Promise<PushSendOutcome>;
}
