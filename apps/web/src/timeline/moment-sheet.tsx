import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  type MomentMedia,
  type MomentPlace,
  type MomentResponse,
  type PersonBrief,
  type PublicShareMoment,
} from '@moment/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { MoreHorizontal } from 'lucide-react';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import type { ChainAppearanceColor, ChainIcon, ChainImageFocus, TemplateManifest } from '@moment/dto';
import { ChainMark } from '@/chain/ChainMark';
import { cardDisplayUrl, posterDisplayUrl } from '@/lib/media-src';
import { formatHappenedClock } from '@/lib/time';
import { resolveMilestoneLabel, summarizePayload } from '@/lib/template';
import { AudioBar } from '@/media/AudioBar';
import { IconButton } from '@/ui/button/index';
import { AlertDialog } from '@/ui/modal/index';
import { MenuItem, ResponsiveMenu } from '@/ui/menu/index';
import { Lightbox } from './lightbox';
import { MomentSheetService } from './moment-sheet.service';
import { firstImage, firstVideo, noteColSpan, noteFaceHeight, noteTiltDeg } from './note-layout';
import './moment-sheet.css';

/**
 * 卡片可消费的 moment 形态（spec people-place §8）：公开分享路径（PublicShareMoment）
 * 无 persons/place 两键——隐私红线在类型层生效；链内路径传 MomentResponse（超集）。
 */
export type MomentSheetMoment = PublicShareMoment & {
  persons?: PersonBrief[];
  place?: MomentPlace | null;
};

// 便利贴纸面（spec sticky-note-album §3）：面子媒体 + 纸边书写。网格不渲染
// ReactionBar、不展开评论；阴影与面子高度只落在 moment-sheet.css。

function stop(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export const MomentSheetContent = observer(function MomentSheetContent({
  moment: momentProp,
  chainName,
  chainColor,
  chainIcon,
  chainAvatarMediaId,
  chainAvatarUrl,
  chainAvatarFocus,
  shareToken,
  readOnly,
  templateManifest,
  ageLabel,
  onPersonFilter,
  onPlaceFilter,
  onTagFilter,
}: {
  moment: MomentSheetMoment;
  chainName?: string;
  chainColor?: ChainAppearanceColor | null;
  chainIcon?: ChainIcon | null;
  chainAvatarMediaId?: string | null;
  chainAvatarUrl?: string | null;
  chainAvatarFocus?: ChainImageFocus | null;
  shareToken?: string;
  readOnly?: boolean;
  templateManifest?: TemplateManifest | null;
  /** baby 年龄标注（「1 岁 2 个月」）；由调用方按链 payload.birthdate 计算 */
  ageLabel?: string;
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
  onTagFilter?: (tag: { id: string; name: string }) => void;
}) {
  const service = useService(MomentSheetService);
  const auth = useService(AuthService);
  const composeSession = useService(ComposeSessionService);

  useEffect(() => {
    service.hydrate(momentProp);
  }, [service, momentProp]);

  const moment = momentProp;
  const mine = auth.user?.id === moment.author.id;
  const images = moment.media.filter((m) => m.mime.startsWith('image/'));
  const lightboxItems: MomentMedia[] =
    images.length > 0 ? images : moment.media.filter((m) => m.mime.startsWith('video/'));
  const isVoice = moment.type === 'voice';
  const audioMedia = isVoice ? moment.media.find((m) => m.mime.startsWith('audio/')) : undefined;
  const coverImage = firstImage(moment);
  const coverVideo = firstVideo(moment);
  const faceHeight = noteFaceHeight(moment);
  const hasFace = (moment.type === 'media' || moment.type === 'video') && faceHeight !== null;
  const faceSrc = coverImage
    ? cardDisplayUrl(coverImage, shareToken)
    : coverVideo
      ? posterDisplayUrl(coverVideo, shareToken)
      : null;
  const placeName = moment.place?.name ?? null;
  const placeOnFace = Boolean(hasFace && placeName);
  const placeOnEdge = Boolean(!hasFace && placeName);
  const voiceThumbSrc = isVoice && coverImage ? cardDisplayUrl(coverImage, shareToken) : null;

  let kindSummary: ReactNode = null;
  if (moment.kind !== 'standard' && templateManifest) {
    const payload = moment.payload ?? {};
    const summaryText = summarizePayload(templateManifest, moment.kind, payload);
    if (summaryText && moment.content.trim() !== summaryText) {
      const { icon } = resolveMilestoneLabel(templateManifest, payload);
      kindSummary = <span className="text-muted">{icon ? `${icon} ${summaryText}` : summaryText}</span>;
    }
  }

  const hasBody = moment.tags.length > 0 || moment.content.length > 0 || kindSummary !== null;
  const persons = moment.persons ?? [];
  const shownPersons = persons.slice(0, 3);

  const placeControl = (overlay: boolean) => {
    if (!placeName) return null;
    const className = overlay
      ? 'moment-note-place pointer-events-auto'
      : 'pointer-events-auto border-0 bg-transparent p-0 text-left text-meta text-muted focus-visible:outline-none focus-visible:ring-focus';
    const label = `📍 ${placeName}`;
    if (onPlaceFilter) {
      return (
        <button
          type="button"
          className={className}
          aria-label={`筛选地点 ${placeName}`}
          onClick={(e) => {
            stop(e);
            onPlaceFilter(placeName);
          }}
        >
          {label}
        </button>
      );
    }
    return overlay ? <span className="moment-note-place">{label}</span> : <span>{label}</span>;
  };

  const writing = (
    <>
      {hasBody && (
        <p className="moment-note-body text-meta text-ink">
          {moment.tags.map((t) =>
            onTagFilter ? (
              <button
                key={t.id}
                type="button"
                className="pointer-events-auto border-0 bg-transparent p-0 text-tag focus-visible:outline-none focus-visible:ring-focus"
                onClick={(e) => {
                  stop(e);
                  onTagFilter({ id: t.id, name: t.name });
                }}
              >
                #{t.name}
              </button>
            ) : (
              <span key={t.id} className="text-tag">
                #{t.name}
              </span>
            ),
          )}
          {moment.content}
          {kindSummary}
        </p>
      )}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted">
        {shownPersons.length > 0 && (
          <span aria-label="和谁在一起">
            {shownPersons.map((p, i) => (
              <span key={p.id}>
                {i > 0 ? ' · ' : null}
                {onPersonFilter ? (
                  <button
                    type="button"
                    aria-label={`筛选 ${p.name}`}
                    className="pointer-events-auto border-0 bg-transparent p-0 text-meta text-muted focus-visible:outline-none focus-visible:ring-focus"
                    onClick={(e) => {
                      stop(e);
                      onPersonFilter({ id: p.id, name: p.name });
                    }}
                  >
                    {p.name}
                  </button>
                ) : (
                  p.name
                )}
              </span>
            ))}
            {persons.length > 3 ? '…' : null}
          </span>
        )}
        {placeOnEdge ? placeControl(false) : null}
        <span>
          {moment.author.nickname} · {formatHappenedClock(moment.happenedAt, moment.happenedTzOffset)}
          {moment.isBackfill ? ' · 补记' : ''}
          {ageLabel ? ` · ${ageLabel}` : ''}
        </span>
        {moment.commentCount > 0 &&
          (readOnly ? (
            <span>{moment.commentCount} 回应</span>
          ) : (
            <Link
              to={`/moments/${moment.id}`}
              className="pointer-events-auto relative z-10 text-muted"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {moment.commentCount} 回应
            </Link>
          ))}
        {chainName && !shareToken && (
          <Link
            to={`/chains/${moment.chainId}`}
            className="pointer-events-auto relative z-10 inline-flex items-center gap-1 text-muted hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <ChainMark
              chainId={moment.chainId}
              color={chainColor}
              icon={chainIcon}
              avatarMediaId={chainAvatarMediaId}
              avatarSrc={chainAvatarUrl}
              avatarFocus={chainAvatarFocus}
              size={14}
            />
            {chainName}
          </Link>
        )}
      </p>
    </>
  );

  return (
    <article
      className={`moment-note${moment.type === 'text' ? ' moment-note-text' : ''}`}
      data-span={noteColSpan(moment)}
      style={{ ['--tilt' as string]: `${noteTiltDeg(moment.id, false)}deg` }}
    >
      {hasFace && (
        <button
          type="button"
          className={`note-face moment-note-face moment-note-face-${faceHeight} w-full border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-focus`}
          aria-label="查看媒体"
          onClick={() => {
            service.lightboxIndex = 0;
          }}
        >
          {faceSrc && <img src={faceSrc} alt="" />}
          {moment.type === 'video' && (
            <span
              aria-hidden
              className="absolute bottom-2 left-2 grid h-8 w-8 place-items-center rounded-full bg-ink text-caption text-surface"
            >
              过
            </span>
          )}
          {images.length > 1 && (
            <span className="absolute bottom-2 right-2 text-caption text-surface">{images.length}</span>
          )}
          {placeOnFace ? placeControl(true) : null}
        </button>
      )}

      {isVoice && (
        <div className="flex items-center gap-2">
          {audioMedia && (
            <div className="min-w-0 flex-1">
              <AudioBar media={audioMedia} shareToken={shareToken} />
            </div>
          )}
          {voiceThumbSrc && (
            <button
              type="button"
              className="moment-note-voice-thumb focus-visible:outline-none focus-visible:ring-focus"
              aria-label="查看媒体"
              onClick={() => {
                service.lightboxIndex = 0;
              }}
            >
              <img src={voiceThumbSrc} alt="" />
            </button>
          )}
        </div>
      )}

      {!readOnly && mine && (
        <div className="absolute right-2 top-2 z-10">
          <ResponsiveMenu
            aria-label="这条时刻的操作"
            sheetTitle="这条时刻"
            trigger={<IconButton icon={MoreHorizontal} label="更多操作" />}
            onAction={(key) => {
              if (key === 'edit') composeSession.openCompose({ chainId: moment.chainId, edit: moment as MomentResponse });
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
        </div>
      )}

      <div className="moment-note-writing relative">
        {!readOnly && (
          <Link
            to={`/moments/${moment.id}`}
            className="absolute inset-0 z-0"
            aria-label="查看这条时刻"
          />
        )}
        <div className={`relative z-10${readOnly ? '' : ' pointer-events-none'}`}>{writing}</div>
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
