import type { ChainAppearanceColor } from '@moment/dto';
import { ChainMark } from '../../components/ChainMark';
import { CapsuleCluster, OverlayNav, overlayNavInset } from '../../components/OverlayNav';
import { useTheme } from '../../theme/use-theme';

export type ChainNavLook = {
  id: string;
  color: ChainAppearanceColor | null;
  icon: string | null;
  avatarUrl: string | null;
};

export { overlayNavInset as chainOverlayInset };

/** 链首页浮动导航：返回单独一颗胶囊；搜索与更多共用一颗。 */
export function ChainOverlayNav({
  title,
  chain,
  collapsed,
  showActions,
  onSearch,
  onMore,
}: {
  title: string;
  chain: ChainNavLook | null;
  collapsed: boolean;
  showActions: boolean;
  onSearch: () => void;
  onMore: () => void;
}) {
  const t = useTheme();
  const showTitle = collapsed && title.length > 0;
  return (
    <OverlayNav
      absolute
      bar={collapsed}
      title={title}
      showTitle={showTitle}
      leading={showTitle && chain ? <ChainMark chain={chain} size={t.space5} /> : null}
      right={
        showActions ? (
          <CapsuleCluster
            tone={collapsed ? 'page' : 'media'}
            items={[
              {
                name: 'search',
                label: '搜索时刻',
                onPress: onSearch,
              },
              {
                name: 'ellipsis',
                label: '更多',
                onPress: onMore,
              },
            ]}
          />
        ) : undefined
      }
    />
  );
}
