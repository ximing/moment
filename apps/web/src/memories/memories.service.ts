import { Service } from '@rabjs/react';
import type { MemoriesYearGroup } from '@moment/dto';
import { client } from '@/api/client';
import { summarizeMemories, todayKey, type MemoriesSummary } from '@/lib/memories';

/**
 * 那年今日（spec memories-today §4）：feed 顶部入口条 + 同页内嵌面板的页面级 Service。
 * 构造即拉一次（入口条判定，即使为空；家庭规模接受，不缓存）；
 * 面板每次打开都重拉，today 在（每次）拉取时定格为字符串，不做过夜驻留刷新。
 * 失败降级：不打 Banner，years 保持空/旧值——首拉失败入口条整体隐藏，不阻塞 feed 主内容；
 * 错误态经 $model.load.error 可读。
 */
export class MemoriesService extends Service {
  years: MemoriesYearGroup[] = [];
  /** 面板展开态（同页内嵌，不新增路由） */
  open = false;
  /** 最近一次拉取定格的查看者本地日期（YYYY-MM-DD） */
  today: string | null = null;

  constructor() {
    super();
    void this.load().catch(() => undefined); // 错误读 $model.load.error；入口条区域降级隐藏
  }

  get summary(): MemoriesSummary | null {
    return this.today ? summarizeMemories(this.years, this.today) : null;
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) void this.load().catch(() => undefined); // 每次打开重拉；today 在打开时定格
  }

  async load(): Promise<void> {
    const today = todayKey();
    const res = await client.getMemoriesToday(today);
    this.today = today;
    this.years = res.years;
  }
}
