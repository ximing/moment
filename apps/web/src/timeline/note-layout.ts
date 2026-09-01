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

export function noteColSpan(moment: PublicShareMoment): NoteColSpan {
  if (moment.type === 'video') return 2;
  const images = moment.media.filter((x) => x.mime.startsWith('image/'));
  if (moment.type === 'media' && images.length >= 2) return 2;
  const r = ratio(images[0]);
  if (r !== null && r >= 1.4) return 2;
  return 1;
}

/**
 * 面子宽/高。手机主档 4:3 / 3:4 原样用，避免固定高度把脑袋裁掉。
 * 超宽（≥1.4）跟 16:9 走并 span 2；超竖夹到 3:4。
 */
export function noteFaceRatio(moment: PublicShareMoment): number | null {
  if (moment.type === 'voice' || moment.type === 'text') return null;
  if (moment.type === 'video') return 16 / 9;
  const images = moment.media.filter((x) => x.mime.startsWith('image/'));
  if (images.length >= 2) return 3 / 2;
  const r = ratio(images[0]);
  if (r === null) return 4 / 3;
  if (r >= 1.4) return Math.min(r, 16 / 9);
  if (r <= 3 / 4) return 3 / 4;
  return r;
}

export function noteTiltDeg(id: string, reducedMotion: boolean): -2 | -1 | 0 | 1 | 2 {
  if (reducedMotion) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 5;
  return ([-2, -1, 0, 1, 2] as const)[h]!;
}
