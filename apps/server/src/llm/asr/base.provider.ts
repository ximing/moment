/**
 * ASR Provider 接口（spec voice-moment §4.1）。
 * 与 LLMProvider 同范式：接口 + 默认实现 + factory 单例 + 测试注入点。
 * 错误分类复用 ../base.provider.js 的 RetryableLLMError / NonRetryableLLMError——
 * 分类语义与 outbox 退避契约完全一致（429/5xx/网络/超时 vs 其他 4xx），类名里的 LLM 是历史命名。
 */
export interface ASRTranscribeRequest {
  /** 音频字节（worker 从 S3 下载）；≤25MB，内存可控 */
  audio: Buffer;
  /** 行上 mime（白名单内），provider 据此定 multipart filename 扩展名 */
  mime: string;
}

export interface ASRProvider {
  transcribe(req: ASRTranscribeRequest): Promise<{ text: string }>;
}
