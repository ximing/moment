import { Service } from '@rabjs/react';
import type { ChainDto, UserProfile } from '@moment/dto';
import { client } from '@/api/client';
import { AuthService } from './auth.service';

/** 全局链列表（spec §3.3）：侧栏 / 首页链色表 / 发布选链共用一份，禁止各拉。 */
export class ChainListService extends Service {
  chains: ChainDto[] = [];
  /**
   * reorder 在途计数（spec chain-ordering §6.3）：> 0 期间 load() 的写回被抑制
   * （请求照发、结果丢弃），由 reorder 收尾的统一 load 收敛。
   * 必须是计数而非布尔——重入语义允许并发第二次 reorder，第一次完成即解除抑制的话，
   * 并发 load 会覆盖第二次的乐观顺序造成闪回。
   */
  private reorderInFlight = 0;
  /**
   * load 代序号（spec §6.3 竞态防护的等价实现，review 修补）：
   * 在途计数只抑制「reorder 期间完成」的 load；一个 reorder 之前发出的 load 若比收尾
   * 收敛 load 更晚 resolve，计数已归零、陈旧数据会压过收敛结果且不再自愈。
   * reorder 起始 ++loadEpoch，load 发起时捕获、写回前比对，不等即丢弃。
   */
  private loadEpoch = 0;

  constructor() {
    super();
    // 冷启动兜底：不能只听 auth:changed——缓存登录态下 AuthService 构造不发事件、
    // me() 失败也不发，只听事件侧栏会一直空（spec §3.3）
    if (this.resolve(AuthService).user) void this.load();
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user) void this.load();
        else this.chains = [];
      },
      'global',
    );
    this.on('chain:changed', () => void this.load(), 'global');
  }

  async load(): Promise<void> {
    const epoch = this.loadEpoch;
    const chains = await client.listChains();
    // 陈旧响应丢弃：发起后有过 reorder（epoch 已推进），本响应早于任何一次 reorder 的乐观/收敛状态
    if (epoch !== this.loadEpoch) return;
    // reorder 在途期间的并发 load（chain:changed 等）写回抑制：丢弃，由 reorder 收尾的统一 load 收敛
    if (this.reorderInFlight > 0) return;
    this.chains = chains;
  }

  /**
   * 拖拽松手提交完整新顺序（spec chain-ordering §6.3）：
   * 乐观更新 → PUT → 统一 load 收敛（成功）/回滚（失败）；失败回滚后 reject，由调用方 toast。
   * 重入允许（不排队、不阻塞 UI）：服务端按到达顺序 last-write-wins，
   * 每次收尾 load 收敛，最终呈现以最后一次 load 为准。
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.chains.map((c) => [c.id, c]));
    const optimistic = orderedIds
      .map((id) => byId.get(id))
      .filter((c): c is ChainDto => c !== undefined);
    // 防御：orderedIds 与当前列表不一致（拖拽期间列表被 chain:changed 改动）时跳过乐观写，
    // 仍提交并由收尾 load 收敛到服务端结果
    if (optimistic.length === orderedIds.length) this.chains = optimistic;
    // 推进代序号：reorder 之前发出的任何在途 load 的响应自此全部视为陈旧
    this.loadEpoch++;
    this.reorderInFlight++;
    let failure: unknown = null;
    try {
      await client.reorderChains({ chainIds: orderedIds });
    } catch (err) {
      failure = err;
    } finally {
      this.reorderInFlight--;
    }
    // 计数已归零才 load：写回生效。成功 = 与服务端收敛；失败 = 回滚到服务端顺序。
    await this.load();
    if (failure) throw failure;
  }
}
