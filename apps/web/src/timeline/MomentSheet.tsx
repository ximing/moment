import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REACTION_EMOJIS, type MomentMedia, type MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { useCompose } from '@/compose/ComposeContext';
import { formatHappenedAt } from '@/lib/time';
import { MediaBlock } from '@/media/MediaBlock';
import { Avatar } from '@/ui/Avatar';
import { Confirm } from '@/ui/Confirm';
import { Lightbox } from './Lightbox';

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
    <article className="rounded-paper bg-white/70 p-5 shadow-paper">
      <header className="flex items-center gap-2.5">
        <Avatar name={moment.author.nickname} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{moment.author.nickname}</span>
            {chainName && !shareToken && (
              <Link to={`/chains/${moment.chainId}`} className="text-sm text-muted hover:text-accent">
                {chainName}
              </Link>
            )}
          </div>
          <p className="text-xs text-muted">
            {formatHappenedAt(moment.happenedAt, moment.happenedTzOffset)}
            {moment.isBackfill && ' · 补记'}
          </p>
        </div>
        {!readOnly && mine && (
          <div className="flex gap-1 text-xs">
            <button type="button" className="text-muted hover:text-ink" onClick={() => openCompose({ chainId: moment.chainId, edit: moment })}>
              编辑
            </button>
            <button type="button" className="text-muted hover:text-danger" onClick={() => setConfirmDel(true)}>
              删除
            </button>
          </div>
        )}
      </header>

      {moment.content && <p className="mt-3 whitespace-pre-wrap text-[17px] leading-relaxed text-ink">{moment.content}</p>}

      <MediaBlock media={moment.media} shareToken={shareToken} onOpen={(i) => setLightbox(i)} />

      {moment.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {moment.tags.map((t) => (
            <span key={t.id} className="text-xs text-muted">
              #{t.name}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="mt-4 flex flex-wrap items-center gap-1">
          {REACTION_EMOJIS.map((emoji) => {
            const count = moment.reactions.find((r) => r.emoji === emoji)?.count ?? 0;
            const mineR = moment.myReaction === emoji;
            if (!mineR && count === 0) {
              return (
                <button
                  key={emoji}
                  type="button"
                  className="rounded-full px-1.5 py-0.5 text-sm opacity-40 hover:opacity-100"
                  onClick={() => react.mutate(emoji)}
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              );
            }
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => react.mutate(emoji)}
                className={`rounded-full px-2 py-0.5 text-sm ${mineR ? 'bg-accent/15' : 'bg-line/60'}`}
              >
                {emoji}
                {count > 0 ? ` ${count}` : ''}
              </button>
            );
          })}
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
        <p className="mt-3 text-xs text-muted">
          {moment.reactions.map((r) => `${r.emoji} ${r.count}`).join('  ')}
          {moment.commentCount > 0 && `  ·  ${moment.commentCount} 条评论`}
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
      <Link to={`/moments/${momentId}`} className="inline-block text-sm text-accent">
        查看全部评论
      </Link>
    </div>
  );
}
