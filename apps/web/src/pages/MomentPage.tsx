import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import { Timeline } from '@/timeline/Timeline';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Field';

export function MomentPage() {
  const { momentId = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: moment, isPending, isError, refetch } = useQuery({
    queryKey: qk.moment(momentId),
    queryFn: () => client.getMoment(momentId),
    enabled: Boolean(momentId),
  });
  const commentsQ = useInfiniteQuery({
    queryKey: qk.comments(momentId),
    queryFn: ({ pageParam }) => client.listComments(momentId, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(momentId),
  });
  const comments = commentsQ.data?.pages.flatMap((p) => p.comments) ?? [];

  const add = useMutation({
    mutationFn: (content: string) => client.createComment(momentId, content),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId) });
      void queryClient.invalidateQueries({ queryKey: qk.moment(momentId) });
      if (moment) {
        void queryClient.invalidateQueries({ queryKey: ['feed'] });
        void queryClient.invalidateQueries({ queryKey: qk.chainMoments(moment.chainId) });
      }
    },
    onError: (e) => setError(humanError(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => client.deleteComment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId) });
      void queryClient.invalidateQueries({ queryKey: qk.moment(momentId) });
    },
    onError: (e) => setError(humanError(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    add.mutate(text.trim());
  }

  if (isPending) return <div className="h-40 animate-pulse rounded-paper bg-white/50" />;
  if (isError || !moment) {
    return <Banner action={{ label: '重试', onClick: () => void refetch() }}>看不到这条时刻</Banner>;
  }

  return (
    <div className="space-y-6">
      <Link to={`/chains/${moment.chainId}`} className="text-sm text-muted hover:text-ink">
        ← 回链
      </Link>
      <Timeline
        moments={[moment]}
        isPending={false}
        isError={false}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => undefined}
        empty={null}
      />
      <section>
        <h2 className="mb-3 font-display text-lg">评论</h2>
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-medium">{c.author.nickname}</span>
              <span className="ml-2">{c.content}</span>
              {user?.id === c.author.id && (
                <button type="button" className="ml-2 text-xs text-muted" onClick={() => del.mutate(c.id)}>
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>
        {commentsQ.hasNextPage && (
          <button type="button" className="mt-2 text-sm text-muted" onClick={() => void commentsQ.fetchNextPage()}>
            更早的评论
          </button>
        )}
        {error && (
          <div className="mt-3">
            <Banner>{error}</Banner>
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-4 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="写一句…" rows={3} />
          <Button type="submit" disabled={add.isPending || !text.trim()}>
            发送
          </Button>
        </form>
      </section>
    </div>
  );
}
