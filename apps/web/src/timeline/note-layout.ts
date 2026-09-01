import type { MomentMedia, PublicShareMoment } from '@moment/dto';

export type NoteColSpan = 1 | 2;

export function firstImage(moment: PublicShareMoment): MomentMedia | undefined {
  return moment.media.find((x) => x.mime.startsWith('image/'));
}

export function firstVideo(moment: PublicShareMoment): MomentMedia | undefined {
  return moment.media.find((x) => x.mime.startsWith('video/'));
}

function ratio(media: MomentMedia | undefined): number | null {
  if (!media || !media.width || !media.height) return null;
  return media.width / media.height;
}

export function clampFaceRatio(r: number): number {
  if (r >= 16 / 9) return 16 / 9;
  if (r <= 9 / 16) return 9 / 16;
  return r;
}

function coverMedia(moment: PublicShareMoment): MomentMedia | undefined {
  return firstImage(moment) ?? firstVideo(moment);
}

export function noteColSpan(moment: PublicShareMoment): NoteColSpan {
  const r = ratio(coverMedia(moment));
  if (r !== null && r < 1) return 1;
  if (moment.type === 'video') return 2;
  if (r !== null && r >= 1.4) return 2;
  return 1;
}

/**
 * 面子宽/高：跟封面媒体自身比走，只把极端超宽/超竖夹到 16:9 / 9:16。
 * 竖屏视频不再强行 16/9，多图不再强行 3/2，避免把竖图裁成横盒子。
 */
export function noteFaceRatio(moment: PublicShareMoment): number | null {
  if (moment.type === 'voice' || moment.type === 'text') return null;
  const r = ratio(coverMedia(moment));
  if (r === null) return moment.type === 'video' ? 16 / 9 : 4 / 3;
  return clampFaceRatio(r);
}

export function noteTiltDeg(id: string, reducedMotion: boolean): -2 | -1 | 0 | 1 | 2 {
  if (reducedMotion) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 5;
  return ([-2, -1, 0, 1, 2] as const)[h]!;
}
