import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MomentMedia, type MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { useCompose } from '@/compose/ComposeContext';
import { ChainMark } from '@/chain/ChainMark';
import { formatHappenedClock } from '@/lib/time';
import { humanError } from '@/lib/errors';
import type { ChainColor, ChainIcon } from '@moment/dto';
import { MediaBlock } from '@/media/MediaBlock';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { KebabButton, Menu, MenuItem } from '@/ui/Menu';
import { Lightbox } from './Lightbox';
import { ReactionBar } from './ReactionBar';

export function MomentSheet({
  moment,
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
  const { user } = useAuth();
  const { openCompose } = useCompose();
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const mine = user?.id === moment.author.id;
  const images = moment.media.filter((m) => !m.mime.startsWith('video/'));
  const lightboxItems: MomentMedia[] = images.length > 0 ? images : moment.media;
  const hasMedia = moment.media.length > 0;

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
          <ReactionBar moment={moment} onReact={(emoji) => react.mutate(emoji)} />
          <button
            type="button"
            className="ml-auto inline-flex h-8 items-center text-[13px] text-muted hover:text-ink"
            onClick={() => setShowComments((v) => !v)}
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
                      openCompose({ chainId: moment.chainId, edit: moment });
                    }}
                  >
                    编辑
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      setConfirmDel(true);
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
            <MediaBlock media={moment.media} shareToken={shareToken} onOpen={(i) => setLightbox(i)} />
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
        {showComments && !readOnly && <CommentPreview momentId={moment.id} chainId={moment.chainId} />}
      </div>
    </div>

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

function CommentPreview({ momentId, chainId }: { momentId: string; chainId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: qk.comments(momentId),
    queryFn: () => client.listComments(momentId, { limit: 20 }),
  });
  const comments = data?.comments ?? [];
  const add = useMutation({
    mutationFn: (content: string) => client.createComment(momentId, content),
    onSuccess: () => {
      setText('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId) });
      void queryClient.invalidateQueries({ queryKey: qk.moment(momentId) });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: qk.chainMoments(chainId) });
    },
    onError: (e) => setError(humanError(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    add.mutate(content);
  }

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {comments.slice(0, 3).map((c) => (
        <p key={c.id} className="text-sm">
          <span className="font-medium">{c.author.nickname}</span>
          <span className="ml-2 text-ink">{c.content}</span>
        </p>
      ))}
      {comments.length > 3 && (
        <Link to={`/moments/${momentId}`} className="inline-block text-sm text-action">
          查看全部评论
        </Link>
      )}
      {error && <Banner>{error}</Banner>}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="写一句…"
          rows={2}
          autoFocus
          className="min-h-[3.25rem] w-full resize-y rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus:border-action"
        />
        <Button type="submit" disabled={add.isPending || !text.trim()}>
          发送
        </Button>
      </form>
    </div>
  );
}
