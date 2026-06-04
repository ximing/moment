import type { ChainDto, ChainRole } from '@moment/dto';

export function roleLabel(role: ChainRole | string | null | undefined): string {
  if (role === 'owner') return '创建者';
  if (role === 'editor') return '可记录';
  if (role === 'viewer') return '只看';
  return '只看';
}

export function canCompose(chain: Pick<ChainDto, 'myRole'> | null | undefined): boolean {
  return chain?.myRole === 'owner' || chain?.myRole === 'editor';
}

export function isOwner(chain: Pick<ChainDto, 'myRole'> | null | undefined): boolean {
  return chain?.myRole === 'owner';
}

export function canInvite(chain: Pick<ChainDto, 'myRole'> | null | undefined): boolean {
  return chain?.myRole === 'owner' || chain?.myRole === 'editor';
}
