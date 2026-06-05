import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MomentMedia, type MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { useCompose } from '@/compose/ComposeContext';
import { formatHappenedAt } from '@/lib/time';
import { MediaBlock } from '@/media/MediaBlock';
import { Avatar } from '@/ui/Avatar';
import { Confirm } from '@/ui/Confirm';
import { Menu } from '@/ui/Menu';
import { Lightbox } from './Lightbox';
import { ReactionBar } from './ReactionBar';

export function MomentSheet({
  moment,
  chainName,
  shareToken,
  readOnly,
}: {
  moment: MomentResponse;
  chainName?: string;
  shareToken?: string;
  readOnly?: boolean;
}) {
  const { user } = useAuth();
  const { openCompose } = useCompose();
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const mine = user?.id === moment.author.id;
  const images = moment.media.filter((m) => !m.mime.startsWith('video/'));
  const lightboxItems: MomentMedia[] = images.length > 0 ? images : moment.media;

  const touch = () => {
    void queryClient.invalidateQueries({ queryKey: qk.moment(moment.id) });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    void queryClient.invalidateQueries({ queryKey: qk.chainMoments(moment.chainId) });
  };

  const react = useMutation({
    mutationFn: (emoji: string) =>
      moment.myReaction === emoji ? client.removeReaction(moment.id) : client.setReaction(moment.id, emoji),
    onSuccess: touch,
  });

  const remove = useMutation({
    mutationFn: () => client.deleteMoment(moment.id),
    onSuccess: () => {
      setConfirmDel(false);
      touch();
    },
  });

  return (
    <article className="relative rounded-card border-2 border-line bg-surface p-5 shadow-card">
      {/* 链节圆环：卡片左上角外侧，中心对齐时间线虚线（容器缩进 26px - 左偏 24px + 环半径 8px ≈ 线中心 x10，spec §3.1） */}
      <span aria-hidden className="absolute -left-6 top-6 h-4 w-4 rounded-full border-2 border-line bg-surface" />
      <header className="flex items-center gap-2.5">
        <Avatar name={moment.author.nickname} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{moment.author.nickname}</span>
            {chainName && !shareToken && (
              <Link to={`/chains/${moment.chainId}`} className="text-sm text-muted hover:text-action">
                {chainName}
              </Link>
            )}
          </div>
          <p className="text-xs text-muted">
            {formatHappenedAt(moment.happenedAt, moment.happenedTzOffset)}
            {moment.isBackfill && ' · 补记'}
          </p>
        </div>
        {/* 本人时刻操作收进 kebab；他人时刻（含 owner 视角）无 kebab 无操作入口（spec §0/§6 非目标，backlog） */}
        {!readOnly && mine && (
          <Menu
            trigger={
              <button
                type="button"
                aria-label="更多操作"
                className="rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-muted shadow-sticker"
              >
                ···
              </button>
            }
          >
            {(close) => (
              <span className="flex flex-col">
                <button
                  type="button"
                  className="rounded px-3 py-1.5 text-left text-sm hover:bg-select"
                  onClick={() => {
                    close();
                    openCompose({ chainId: moment.chainId, edit: moment });
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="rounded px-3 py-1.5 text-left text-sm text-danger hover:bg-select"
                  onClick={() => {
                    close();
                    setConfirmDel(true);
                  }}
                >
                  删除
                </button>
              </span>
            )}
          </Menu>
        )}
      </header>

      {moment.content && <p className="mt-3 whitespace-pre-wrap text-[17px] leading-relaxed text-ink">{moment.content}</p>}

      <MediaBlock media={moment.media} shareToken={shareToken} onOpen={(i) => setLightbox(i)} />

      {moment.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {moment.tags.map((t) => (
            <span
              key={t.id}
              className="rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-xs text-muted shadow-sticker"
            >
              #{t.name}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <ReactionBar moment={moment} onReact={(emoji) => react.mutate(emoji)} />
          <button
            type="button"
            className="ml-auto text-sm text-muted hover:text-ink"
            onClick={() => setShowComments((v) => !v)}
          >
            {moment.commentCount} 条评论
          </button>
        </div>
      )}

      {readOnly && (moment.commentCount > 0 || moment.reactions.length > 0) && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {moment.reactions.map((r) => (
            <span
              key={r.emoji}
              className="rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-xs"
            >
              {r.emoji} {r.count}
            </span>
          ))}
          {moment.commentCount > 0 && <span>· {moment.commentCount} 条评论</span>}
        </p>
      )}

      {showComments && !readOnly && <CommentPreview momentId={moment.id} />}

      {lightbox !== null && (
        <Lightbox
          items={lightboxItems}
          index={Math.min(lightbox, lightboxItems.length - 1)}
          shareToken={shareToken}
          onClose={() => setLightbox(null)}
          onIndex={setLightbox}
        />
      )}

      {confirmDel && (
        <Confirm
          title="删除这条时刻？"
          body="删除后家人在时间线里就看不到了。"
          confirmLabel="删除"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDel(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </article>
  );
}

function CommentPreview({ momentId }: { momentId: string }) {
  const { data } = useQuery({
    queryKey: qk.comments(momentId),
    queryFn: () => client.listComments(momentId, { limit: 20 }),
  });
  const comments = data?.comments ?? [];
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {comments.slice(0, 3).map((c) => (
        <p key={c.id} className="text-sm">
          <span className="font-medium">{c.author.nickname}</span>
          <span className="ml-2 text-ink">{c.content}</span>
        </p>
      ))}
      <Link to={`/moments/${momentId}`} className="inline-block text-sm text-action">
        查看全部评论
      </Link>
    </div>
  );
}
