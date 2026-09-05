export type ChainSheetSection = 'share' | 'members' | 'people' | 'tags' | 'profile' | 'jobs';

export type ChainSheetItem = { key: ChainSheetSection; label: string };

const SECTION_LABEL: Record<ChainSheetSection, string> = {
  share: '分享',
  members: '成员',
  people: '人物',
  tags: '标签',
  profile: '设置',
  jobs: '处理中',
};

/** 链页右上角「更多」：按角色露出 Web「这条链」同款入口。 */
export function chainSheetItems(role: string | undefined): ChainSheetItem[] {
  const owner = role === 'owner';
  const compose = owner || role === 'editor';
  const keys: ChainSheetSection[] = [];
  if (owner) keys.push('share');
  keys.push('members');
  if (compose) {
    keys.push('people');
    keys.push('tags');
  }
  keys.push('profile');
  if (owner) keys.push('jobs');
  return keys.map((key) => ({ key, label: SECTION_LABEL[key] }));
}

export function chainSheetTitle(section: string | undefined): string {
  if (section && section in SECTION_LABEL) return SECTION_LABEL[section as ChainSheetSection];
  return '这条链';
}
