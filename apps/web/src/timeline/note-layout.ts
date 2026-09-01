import type { MomentMedia, PublicShareMoment } from '@moment/dto';

export type NoteColSpan = 1 | 2;
export type NoteFaceHeight = 168 | 192 | 240 | null;

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

export function noteFaceHeight(moment: PublicShareMoment): NoteFaceHeight {
  if (moment.type === 'voice' || moment.type === 'text') return null;
  if (moment.type === 'video') return 192;
  const images = moment.media.filter((x) => x.mime.startsWith('image/'));
  if (images.length >= 2) return 168;
  const r = ratio(images[0]);
  if (r === null) return 168;
  if (r >= 1.4) return 192;
  if (r > 0 && 1 / r >= 1.25) return 240;
  if (r >= 0.9 && r <= 1.1) return 192;
  return 168;
}

export function noteTiltDeg(id: string, reducedMotion: boolean): -2 | -1 | 0 | 1 | 2 {
  if (reducedMotion) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 5;
  return ([-2, -1, 0, 1, 2] as const)[h]!;
}
