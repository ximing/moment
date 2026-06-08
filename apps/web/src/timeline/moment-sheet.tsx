import { useEffect, type FormEvent } from 'react';
import { Link } from 'react-router';
import { type MomentMedia, type MomentResponse } from '@moment/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { humanError } from '@/lib/errors';
import type { ChainColor, ChainIcon } from '@moment/dto';
import { ChainMark } from '@/chain/ChainMark';
import { formatHappenedClock } from '@/lib/time';
import { MediaBlock } from '@/media/MediaBlock';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { KebabButton, Menu, MenuItem } from '@/ui/Menu';
import { Lightbox } from './Lightbox';
import { ReactionBar } from './ReactionBar';
import { MomentSheetService } from './moment-sheet.service';

const MomentSheetContent = observer(function MomentSheetContent({
  moment: momentProp,
  chainName,
  chainColor,
  chainIcon,
  shareToken,
  readOnly,
}: {
  moment: MomentResponse;
  chainName?: string;
  chainColor?: ChainColor | null;
  chainIcon?: ChainIcon | null;
  shareToken?: string;
  readOnly?: boolean;
  /** 日子结在分组头上，卡片不再挂链节环；保留参数以免调用方报错 */
  hideKnot?: boolean;
}) {
  const service = useService(MomentSheetService);
  const auth = useService(AuthService);
  const composeSession = useService(ComposeSessionService);

  useEffect(() => {
    service.hydrate(momentProp);
  }, [service, momentProp]);

  // 评论展开时按需拉预览（Service 内幂等，同卡只拉一次）
  useEffect(() => {
    if (service.showComments) void service.loadPreview();
  }, [service, service.showComments]);

  const moment = momentProp; // 卡片渲染永远用父层传入的最新数据（feed 重拉后 prop 已是新值）
  const mine = auth.user?.id === moment.author.id;
  const images = moment.media.filter((m) => !m.mime.startsWith('video/'));
  const lightboxItems: MomentMedia[] = images.length > 0 ? images : moment.media;
  const hasMedia = moment.media.length > 0;

  const tags = moment.tags.length > 0 && (
    <div className="mt-2 flex flex-wrap gap-2">
      {moment.tags.map((t) => (
        <span key={t.id} className="text-xs text-muted">
          #{t.name}
        </span>
      ))}
    </div>
  );

  const acts = (
    <>
      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReactionBar moment={moment} onReact={(emoji) => void service.react(emoji)} />
          <button
            type="button"
            className="ml-auto inline-flex h-8 items-center text-[13px] text-muted hover:text-ink"
            onClick={() => (service.showComments = !service.showComments)}
          >
            {moment.commentCount} 条评论
          </button>
        </div>
      )}
      {readOnly && (moment.commentCount > 0 || moment.reactions.length > 0) && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          {moment.reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji} {r.count}
            </span>
          ))}
          {moment.commentCount > 0 && <span>{moment.commentCount} 条评论</span>}
        </p>
      )}
    </>
  );

  function onSubmitPreview(e: FormEvent) {
    e.preventDefault();
    if (!service.previewText.trim()) return;
    void service.submitPreviewComment().catch(() => undefined); // 错误读 $model.submitPreviewComment.error
  }

  return (
    <article>
    <div className="flex gap-3">
      <Avatar name={moment.author.nickname} src={moment.author.avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <header className="mb-2 flex items-baseline gap-2 text-[13px]">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-ink">{moment.author.nickname}</span>
            <span className="text-muted">{formatHappenedClock(moment.happenedAt, moment.happenedTzOffset)}</span>
            {moment.isBackfill && <span className="text-muted">补记</span>}
            {chainName && !shareToken && (
              <Link to={`/chains/${moment.chainId}`} className="inline-flex items-center gap-1 text-muted hover:text-ink">
                <ChainMark chainId={moment.chainId} color={chainColor} icon={chainIcon} size={14} />
                {chainName}
              </Link>
            )}
          </div>
          {!readOnly && mine && (
            <Menu trigger={<KebabButton label="更多操作" />}>
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      close();
                      composeSession.openCompose({ chainId: moment.chainId, edit: moment });
                    }}
                  >
                    编辑
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      service.confirmDel = true;
                    }}
                  >
                    删除
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
        </header>
        {hasMedia ? (
          <>
            {moment.content && (
              <p className="mb-2 whitespace-pre-wrap text-base leading-[1.65] text-ink">{moment.content}</p>
            )}
            <MediaBlock media={moment.media} shareToken={shareToken} onOpen={(i) => (service.lightboxIndex = i)} />
          </>
        ) : (
          moment.content && (
            <div className="rounded-card bg-surface px-4 py-3">
              <p className="whitespace-pre-wrap text-base leading-[1.65] text-ink">{moment.content}</p>
            </div>
          )
        )}
        {tags}
        {acts}
        {service.showComments && !readOnly && (
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            {service.preview.slice(0, 3).map((c) => (
              <p key={c.id} className="text-sm">
                <span className="font-medium">{c.author.nickname}</span>
                <span className="ml-2 text-ink">{c.content}</span>
              </p>
            ))}
            {service.preview.length > 3 && (
              <Link to={`/moments/${moment.id}`} className="inline-block text-sm text-action">
                查看全部评论
              </Link>
            )}
            {service.$model.submitPreviewComment.error && (
              <Banner>{humanError(service.$model.submitPreviewComment.error)}</Banner>
            )}
            <form onSubmit={onSubmitPreview} className="flex items-end gap-2">
              <textarea
                value={service.previewText}
                onChange={(e) => (service.previewText = e.target.value)}
                placeholder="写一句…"
                rows={2}
                autoFocus
                className="min-h-[3.25rem] w-full resize-y rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus:border-action"
              />
              <Button type="submit" disabled={service.$model.submitPreviewComment.loading || !service.previewText.trim()}>
                发送
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>

      {service.lightboxIndex !== null && (
        <Lightbox
          items={lightboxItems}
          index={Math.min(service.lightboxIndex, lightboxItems.length - 1)}
          shareToken={shareToken}
          onClose={() => (service.lightboxIndex = null)}
          onIndex={(n) => (service.lightboxIndex = n)}
        />
      )}

      {service.confirmDel && (
        <Confirm
          title="删除这条时刻？"
          body="删除后家人在时间线里就看不到了。"
          confirmLabel="删除"
          danger
          busy={service.$model.remove.loading}
          onCancel={() => (service.confirmDel = false)}
          onConfirm={() => void service.remove()}
        />
      )}
    </article>
  );
});

export const MomentSheet = bindServices(MomentSheetContent, [MomentSheetService]);
