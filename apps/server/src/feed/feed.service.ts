import type { FeedResponse } from '@moment/dto';
import { Service } from 'typedi';
import { serializeMoments } from '../moments/moment-serializer.js';
import { getMyChains } from './membership.js';
import { queryMomentPage } from './moment-query.js';
import type { MomentOrder } from './cursor.js';

export interface FeedQueryParsed {
  cursor?: string;
  /** 未传 = 全部我的链；传了 = 与我的链求交集（收窄） */
  chainIds?: string[];
  tagId?: string;
  order: MomentOrder;
  limit: number;
}

@Service()
export class FeedService {
  async feed(userId: string, query: FeedQueryParsed): Promise<FeedResponse> {
    const myChains = await getMyChains(userId);
    let scope = [...myChains.keys()];
    if (query.chainIds) {
      // 静默过滤非我的链：不报错也不泄露链存在性（spec §5.1 / 本计划 Global Constraints）
      scope = query.chainIds.filter((id) => myChains.has(id));
    }
    // scope 为空时不提前返回：由 queryMomentPage 统一处理（返回空页，但坏游标仍 400 INVALID_CURSOR）

    const page = await queryMomentPage({
      chainIds: scope,
      order: query.order,
      limit: query.limit,
      cursor: query.cursor,
      tagId: query.tagId,
    });
    return { moments: await serializeMoments(page.rows, userId), nextCursor: page.nextCursor };
  }
}
