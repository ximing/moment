import { useEffect, type FormEvent } from 'react';
import { Link } from 'react-router';
import { type MomentMedia, type MomentResponse } from '@moment/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { MoreHorizontal } from 'lucide-react';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { humanError } from '@/lib/errors';
import type { ChainColor, ChainIcon } from '@moment/dto';
import { ChainMark } from '@/chain/ChainMark';
import { formatHappenedClock } from '@/lib/time';
import { MediaBlock } from '@/media/MediaBlock';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { MessageCircle } from 'lucide-react';
import { Button, IconButton } from '@/ui/button/index';
import { Banner } from '@/ui/feedback/index';
import { Textarea } from '@/ui/field/index';
import { AlertDialog } from '@/ui/modal/index';
import { MenuItem, ResponsiveMenu } from '@/ui/menu/index';
import { Lightbox } from './lightbox';
import { ReactionBar } from './reaction-bar';
import { MomentSheetService } from './moment-sheet.service';

// 时刻内容（C 端总规范 §6）：不是完整白卡，而是共享内容列左缘的一组内容。
// 作者行 ··· 固定右缘；Tag 在正文前、同一文字流（--tag 色，不画胶囊）；纯文字
// 用 --surface 色面（无阴影），媒体自成基底；情绪入口在左、回应（N 条回应）在右。
// 视觉只消费 token：text-body / text-meta / rounded-surface-md / bg-surface /
// text-tag / bg-select，焦点环 ring-focus；内容层不引入任何阴影。

// 具名导出是测试 seam：bindServices 的私有容器实例在渲染前无法播种，
// 测试在全局容器注册 MomentSheetService 后直接渲染本组件（chain-home.test.tsx）。
export const MomentSheetContent = observer(function MomentSheetContent({
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

  // Tag 是内容语义（spec §6.2）：正文前、同一文字流、同一字号；只靠 --tag 色与
  // # 前缀区分。只有媒体、正文为空时紧贴媒体之前渲染为一段文本（自然降级）。
  const inlineTags = moment.tags.length > 0 && (
    <span aria-label="标签" className="text-tag">
      {moment.tags.map((t) => (
        <span key={t.id} className="mr-2">
          #{t.name}
        </span>
      ))}
    </span>
  );
  const copy = (inlineTags || moment.content) && (
    <p className="whitespace-pre-wrap text-body text-ink">
      {inlineTags}
      {moment.content}
    </p>
  );

  const acts = (
    <>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ReactionBar moment={moment} onReact={(emoji) => void service.react(emoji)} />
          <button
            type="button"
            className="ml-auto inline-flex min-h-touch-control items-center gap-1 text-meta text-muted transition-colors duration-[var(--ease)] hover:text-ink focus-visible:outline-none focus-visible:ring-focus"
            onClick={() => (service.showComments = !service.showComments)}
          >
            <Icon icon={MessageCircle} size={16} />
            {moment.commentCount} 条回应
          </button>
        </div>
      )}
      {readOnly && (moment.commentCount > 0 || moment.reactions.length > 0) && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-meta text-muted">
          {moment.reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji} {r.count}
            </span>
          ))}
          {moment.commentCount > 0 && <span>{moment.commentCount} 条回应</span>}
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
        <header className="mb-1 flex items-center gap-2 text-meta">
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
            <ResponsiveMenu
              aria-label="这条时刻的操作"
              sheetTitle="这条时刻"
              trigger={<IconButton icon={MoreHorizontal} label="更多操作" className="-my-1" />}
              onAction={(key) => {
                if (key === 'edit') composeSession.openCompose({ chainId: moment.chainId, edit: moment });
                if (key === 'delete') service.confirmDel = true;
              }}
            >
              <MenuItem id="edit" textValue="编辑">
                编辑
              </MenuItem>
              <MenuItem id="delete" textValue="删除" tone="danger">
                删除
              </MenuItem>
            </ResponsiveMenu>
          )}
        </header>
        {hasMedia ? (
          <>
            {copy && <div className="mb-2">{copy}</div>}
            <MediaBlock media={moment.media} shareToken={shareToken} onOpen={(i) => (service.lightboxIndex = i)} />
          </>
        ) : (
          copy && (
            // 纯文字用 --surface 色面：无边框、无阴影（spec §6.1）
            <div className="rounded-surface-md bg-surface px-4 py-3">{copy}</div>
          )
        )}
        {acts}
        {service.showComments && !readOnly && (
          <div className="mt-3 flex flex-col gap-2">
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
              <Banner tone="error">{humanError(service.$model.submitPreviewComment.error)}</Banner>
            )}
            <form onSubmit={onSubmitPreview} className="flex items-end gap-2">
              <Textarea
                aria-label="写一句"
                value={service.previewText}
                onChange={(e) => (service.previewText = e.target.value)}
                placeholder="写一句…"
                rows={2}
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

      <AlertDialog
        open={service.confirmDel}
        title="删除这条时刻？"
        body="删除后家人在时间线里就看不到了。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        busy={service.$model.remove.loading}
        onCancel={() => (service.confirmDel = false)}
        onConfirm={() => void service.remove()}
      />
    </article>
  );
});

export const MomentSheet = bindServices(MomentSheetContent, [MomentSheetService]);
