import { randomBytes, randomUUID } from 'node:crypto';
import {
  chainAppearanceColorSchema,
  type ChainAppearanceColor,
  type CreateShareLinkInput,
  type PublicShareQuery,
  type PublicShareResponse,
  type ShareLinkDto,
  type ShareLinkListResponse,
} from '@moment/dto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { focusFromDb } from '../chains/chain-appearance.js';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { chains, recaps, shareLinks, type ShareLink } from '../db/schema.js';
import { queryMomentPage } from '../feed/moment-query.js';
import { signReadyMediaUrls } from '../media/sign-get.js';
import { serializeMoments } from '../moments/moment-serializer.js';
import { AggregateService } from '../templates/aggregate.service.js';
import { TemplateService } from '../templates/template.service.js';

function toDto(row: ShareLink): ShareLinkDto {
  return {
    id: row.id,
    chainId: row.chainId,
    token: row.token,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 读取防御：与 chain.service.ts 同义——color 列只接受预设色或 #RRGGBB（历史异常值 → null）。 */
function asAppearanceColor(v: string | null): ChainAppearanceColor | null {
  if (v === null) return null;
  const parsed = chainAppearanceColorSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

@Service()
export class ShareLinkService {
  constructor(
    private readonly policy: ChainPolicy,
    private readonly templates: TemplateService,
    private readonly aggregates: AggregateService,
  ) {}

  /**
   * 创建（owner 鉴权在 requireChainRole 中间件完成，CONVENTIONS §3.1：controller 内禁止手写角色判断）。
   * 直接返回内存行是安全的：Task 2 三个 timestamp 列为 fsp:3，与 JS Date 毫秒精度一致，
   * create 的 201 响应与后续 list 回查响应精度自洽（无需回查或截断）。
   */
  async create(userId: string, chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto> {
    const row: ShareLink = {
      id: randomUUID(),
      chainId,
      token: randomBytes(32).toString('hex'), // 64 字符不可猜测（spec §6）
      createdBy: userId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      revokedAt: null,
      createdAt: new Date(),
    };
    await db.insert(shareLinks).values(row);
    return toDto(row);
  }

  /** owner 管理视图：含已吊销（可审计），createdAt 倒序 */
  async list(chainId: string): Promise<ShareLinkListResponse> {
    const rows = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.chainId, chainId))
      .orderBy(desc(shareLinks.createdAt));
    return { items: rows.map(toDto) };
  }

  /** 吊销（幂等）：资源 id 反查链 → ChainPolicy（非成员 404 CHAIN_NOT_FOUND、非 owner 403 CHAIN_ROLE_INSUFFICIENT） */
  async revoke(userId: string, shareLinkId: string): Promise<void> {
    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, shareLinkId)).limit(1);
    if (!row) throw new NotFoundError('SHARE_LINK_NOT_FOUND');
    await this.policy.require(userId, row.chainId, 'owner');
    if (row.revokedAt) return; // 幂等
    await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, row.id));
  }

  /** 有效 = 存在 + 未吊销 + 未过期；无效一律 null（匿名路径统一 404，不区分原因） */
  async findValidByToken(token: string): Promise<ShareLink | null> {
    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1);
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  }

  /**
   * 匿名只读视图（spec §4 Public）：token 无效/过期/吊销一律 404 SHARE_NOT_FOUND；
   * 固定 happened_at 排序，复用 feed 查询 builder（自带 deleted_at IS NULL，CONVENTIONS §3.4）；
   * serializeMoments 不传 viewerId → myReaction 恒 null（计数只读，见计划 Global Constraints 决策）。
   */
  async getSharedChain(token: string, query: PublicShareQuery): Promise<PublicShareResponse> {
    const link = await this.findValidByToken(token);
    if (!link) throw new NotFoundError('SHARE_NOT_FOUND');

    const [chain] = await db
      .select({
        name: chains.name,
        description: chains.description,
        template: chains.template,
        shareRecapsEnabled: chains.shareRecapsEnabled,
        avatarMediaId: chains.avatarMediaId,
        avatarFocusX: chains.avatarFocusX,
        avatarFocusY: chains.avatarFocusY,
        coverMediaId: chains.coverMediaId,
        coverFocusX: chains.coverFocusX,
        coverFocusY: chains.coverFocusY,
        color: chains.color,
        icon: chains.icon,
      })
      .from(chains)
      .where(eq(chains.id, link.chainId))
      .limit(1);
    if (!chain) throw new NotFoundError('SHARE_NOT_FOUND');

    // 与 ChainDto 同语义（chain-appearance 设计 §4.3）：图片 placement 仅在关联 media
    // 存在且 ready 时成组返回 mediaId/稳定 URL/focus，否则三者全 null；
    // 读取防御性优先级 avatarMediaId > icon > color。
    const appearanceMediaIds = [chain.avatarMediaId, chain.coverMediaId].filter(
      (id): id is string => id !== null,
    );
    const signedMedia = await signReadyMediaUrls(appearanceMediaIds);
    const avatarReady = chain.avatarMediaId !== null && signedMedia.has(chain.avatarMediaId);
    const coverReady = chain.coverMediaId !== null && signedMedia.has(chain.coverMediaId);
    const icon = avatarReady ? null : chain.icon;
    const color = avatarReady || icon !== null ? null : asAppearanceColor(chain.color);

    const page = await queryMomentPage({
      chainIds: [link.chainId],
      order: 'happened_at',
      limit: query.limit,
      cursor: query.cursor,
    });
    const manifest = (await this.templates.getByKey(chain.template)).manifest;

    // 附最近一期 ready/degraded recap（spec §6 + S2 注：含 degraded，T7 回写 spec §6）
    let recap: typeof recaps.$inferSelect | undefined;
    if (chain.shareRecapsEnabled) {
      const [latest] = await db
        .select()
        .from(recaps)
        .where(
          and(
            eq(recaps.chainId, link.chainId),
            inArray(recaps.status, ['ready', 'degraded']),
          ),
        )
        .orderBy(desc(recaps.period))
        .limit(1);
      recap = latest;
    }

    return {
      chain: {
        name: chain.name,
        description: chain.description,
        avatarMediaId: avatarReady ? chain.avatarMediaId : null,
        avatarUrl: avatarReady && chain.avatarMediaId ? (signedMedia.get(chain.avatarMediaId) ?? null) : null,
        avatarFocus: avatarReady ? focusFromDb(chain.avatarFocusX, chain.avatarFocusY) : null,
        coverMediaId: coverReady ? chain.coverMediaId : null,
        coverUrl: coverReady && chain.coverMediaId ? (signedMedia.get(chain.coverMediaId) ?? null) : null,
        coverFocus: coverReady ? focusFromDb(chain.coverFocusX, chain.coverFocusY) : null,
        color,
        icon,
      },
      template: chain.template,
      templateManifest: manifest,
      aggregates: await this.aggregates.projectAll(link.chainId, manifest),
      // 隐私红线（spec §8）：不传 includePrivate（默认 false）——公开相册输出零 persons/place。
      moments: await serializeMoments(page.rows),
      nextCursor: page.nextCursor,
      ...(recap ? {
        recap: {
          id: recap.id,
          chainId: recap.chainId,
          period: recap.period,
          status: recap.status,
          content: recap.content,
          highlights: recap.highlights,
          model: recap.model,
          promptVersion: recap.promptVersion,
          tokenUsage: recap.tokenUsage,
          error: recap.error,
          generatedAt: recap.generatedAt ? recap.generatedAt.toISOString() : null,
          createdAt: recap.createdAt.toISOString(),
          updatedAt: recap.updatedAt.toISOString(),
        },
      } : {}),
    };
  }
}
