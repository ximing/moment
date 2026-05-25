import { Link } from 'react-router';
import { MessageCircle } from 'lucide-react';
import type { MomentResponse } from '@moment/dto';
import { formatHappenedAt } from '@/lib/time';
import { MediaGrid } from './MediaGrid';

/** moment 卡片：feed / 链时间线共用。点击评论数或「详情」进入详情页。 */
export function MomentCard({ moment, chainName }: { moment: MomentResponse; chainName?: string }) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <span className="font-medium">{moment.author.nickname}</span>
        {chainName && (
          <Link to={`/chains/${moment.chainId}`} className="text-gray-500 hover:underline">
            · {chainName}
          </Link>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {formatHappenedAt(moment.happenedAt, moment.happenedTzOffset)}
          {moment.isBackfill && ' · 补发'}
        </span>
      </div>
      {moment.content && <p className="whitespace-pre-wrap text-[15px]">{moment.content}</p>}
      <MediaGrid media={moment.media} />
      {moment.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {moment.tags.map((t) => (
            <span key={t.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              #{t.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-0.5">
          <MessageCircle size={13} />
          {moment.commentCount}
        </span>
        <span className="flex flex-wrap gap-1">
          {moment.reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji}
              {r.count}
            </span>
          ))}
        </span>
        <Link to={`/moments/${moment.id}`} className="ml-auto text-gray-400 hover:text-gray-900">
          详情
        </Link>
      </div>
    </article>
  );
}
