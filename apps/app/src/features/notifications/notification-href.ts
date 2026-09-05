import type { NotificationDto } from '@moment/dto';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 通知点击目标：入链邀请走接受页，其余时刻/链。 */
export function notificationHref(n: Pick<NotificationDto, 'type' | 'payload'>): string | null {
  const p = n.payload as {
    momentId?: unknown;
    chainId?: unknown;
    inviteToken?: unknown;
    data?: { momentId?: unknown; chainId?: unknown; inviteToken?: unknown };
  };
  const inviteToken = str(p.inviteToken) ?? str(p.data?.inviteToken);
  if (n.type === 'invite.created' && inviteToken) return `/invites/${inviteToken}`;
  const momentId = str(p.momentId) ?? str(p.data?.momentId);
  if (momentId) return `/moments/${momentId}`;
  const chainId = str(p.chainId) ?? str(p.data?.chainId);
  if (chainId) return `/chains/${chainId}`;
  return null;
}
