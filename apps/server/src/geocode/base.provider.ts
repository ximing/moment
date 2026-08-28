/**
 * Geocode Provider 接口（spec people-place §4）。
 * 与 LLMProvider / ASRProvider 同范式：接口 + 默认实现 + factory 单例 + 测试注入点。
 * 错误分类复用 ../llm/base.provider.js 的 RetryableLLMError / NonRetryableLLMError——
 * 分类语义与 outbox 退避契约一致（429/5xx/网络/超时 vs 其他 4xx），类名里的 LLM 是历史命名
 * （先例：llm/asr/base.provider.ts）。
 */
export interface GeocodeProvider {
  /**
   * 逆地理编码：坐标 → 地名。
   * 入参为 **WGS-84**（DB 落库原值坐标系；GCJ-02 换算是 provider 内部实现细节，
   * 调用方不得预先换算——spec §4 坐标系红线）。
   *
   * 返回语义（本计划偏差 3 钉死）：
   * - string：formatted_address（可能被调用方按列宽截断）
   * - null：provider 明确成功但确定无地址（如高德 status=1 而 formatted_address 空）——
   *   调用方消费即终态，不重试
   * - 抛错：本次尝试失败（网络/超时/HTTP 非 2xx/业务 status 非 1/畸形响应）——
   *   调用方传播给 outbox processor 走既有指数退避
   */
  reverse(lat: number, lng: number): Promise<string | null>;
}
