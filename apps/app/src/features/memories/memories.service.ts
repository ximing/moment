import { Service } from '@rabjs/react';
import type { MemoriesYearGroup } from '@moment/dto';
import { client } from '../../lib/api';
import { summarizeMemories, type MemoriesSummary } from './text';

/**
 * 那年今日（spec memories-today §5）：入口条与详情页各自的页面级 Service
 * （两处各自 bindServices，实例互不共享；不新增全局 Service）。
 *
 * today 定格：两个使用点都在组件挂载时把日期定格为字符串，经 hydrate(date) 传入——
 * 页面存活跨午夜不漂移；Service 自身不读设备时钟。
 *
 * 失败降级（入口条）：years 保持空 → summary 为 null → 整条不渲染，不打扰；
 * 错误态经 $model.load.error 可读（详情页据此渲染错误态）。
 */
export class MemoriesService extends Service {
  /** hydrate 定格的查看者本地日期（YYYY-MM-DD）；空串 = 尚未 hydrate */
  date = '';
  years: MemoriesYearGroup[] = [];

  get summary(): MemoriesSummary | null {
    return this.date ? summarizeMemories(this.years, this.date) : null;
  }

  /** 路由 param / 组件定格日期进来；幂等挡双调用（沿用 MomentPageService.hydrate 惯例）。 */
  hydrate(date: string): void {
    if (this.date === date) return;
    this.date = date;
    this.years = [];
    void this.load(date).catch(() => undefined); // 错误读 $model.load.error
  }

  async load(date: string): Promise<void> {
    const res = await client.getMemoriesToday(date);
    if (date !== this.date) return; // 过期响应丢弃
    this.years = res.years;
  }
}
