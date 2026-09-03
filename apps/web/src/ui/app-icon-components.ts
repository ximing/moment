import type { IconKey } from '@moment/icons';
import MoodJoy from '@moment/icons/svg/mood-joy.svg?react';
import MoodLove from '@moment/icons/svg/mood-love.svg?react';
import MoodCry from '@moment/icons/svg/mood-cry.svg?react';
import MoodAngry from '@moment/icons/svg/mood-angry.svg?react';
import MoodSleepy from '@moment/icons/svg/mood-sleepy.svg?react';
import ReactionLike from '@moment/icons/svg/reaction-like.svg?react';
import ReactionLove from '@moment/icons/svg/reaction-love.svg?react';
import ReactionLaugh from '@moment/icons/svg/reaction-laugh.svg?react';
import ReactionWow from '@moment/icons/svg/reaction-wow.svg?react';
import ReactionSad from '@moment/icons/svg/reaction-sad.svg?react';
import ReactionCelebrate from '@moment/icons/svg/reaction-celebrate.svg?react';
import ReactionClap from '@moment/icons/svg/reaction-clap.svg?react';
import ReactionStrong from '@moment/icons/svg/reaction-strong.svg?react';
import ReactionThanks from '@moment/icons/svg/reaction-thanks.svg?react';
import RatingLove from '@moment/icons/svg/rating-love.svg?react';
import RatingGood from '@moment/icons/svg/rating-good.svg?react';
import RatingOk from '@moment/icons/svg/rating-ok.svg?react';
import RatingPass from '@moment/icons/svg/rating-pass.svg?react';
import MilestoneFirstSmile from '@moment/icons/svg/milestone-first-smile.svg?react';
import MilestoneFirstRoll from '@moment/icons/svg/milestone-first-roll.svg?react';
import MilestoneFirstSit from '@moment/icons/svg/milestone-first-sit.svg?react';
import MilestoneFirstCrawl from '@moment/icons/svg/milestone-first-crawl.svg?react';
import MilestoneFirstStand from '@moment/icons/svg/milestone-first-stand.svg?react';
import MilestoneFirstSteps from '@moment/icons/svg/milestone-first-steps.svg?react';
import MilestoneFirstWord from '@moment/icons/svg/milestone-first-word.svg?react';
import MilestoneFirstTooth from '@moment/icons/svg/milestone-first-tooth.svg?react';
import TplBaby from '@moment/icons/svg/tpl-baby.svg?react';
import TplTravel from '@moment/icons/svg/tpl-travel.svg?react';
import TplDaily from '@moment/icons/svg/tpl-daily.svg?react';
import TplReading from '@moment/icons/svg/tpl-reading.svg?react';
import TplCareer from '@moment/icons/svg/tpl-career.svg?react';

// 简报原稿是 ComponentType<SVGProps<SVGSVGElement>>，但本 monorepo 存在两份 @types/react
// 物理副本（根 19.1.17 供 Expo / apps/web 19.2.x），vite-plugin-svgr/client 的
// *.svg?react 声明经真实路径解析命中根副本，与源码命中的 apps/web 副本互不赋值
// （Ref 回调的 VoidOrUndefinedOnly 品牌类型互不相干）。直接从导入的组件取类型，
// 让索引与 svgr 声明天然一致，绕开双副本类型冲突。
type SvgComponent = typeof MoodJoy;

export const APP_ICON_COMPONENTS: Record<IconKey, SvgComponent> = {
  'mood-joy': MoodJoy,
  'mood-love': MoodLove,
  'mood-cry': MoodCry,
  'mood-angry': MoodAngry,
  'mood-sleepy': MoodSleepy,
  'reaction-like': ReactionLike,
  'reaction-love': ReactionLove,
  'reaction-laugh': ReactionLaugh,
  'reaction-wow': ReactionWow,
  'reaction-sad': ReactionSad,
  'reaction-celebrate': ReactionCelebrate,
  'reaction-sweet': MoodLove, // 别名（spec §3.1）
  'reaction-clap': ReactionClap,
  'reaction-strong': ReactionStrong,
  'reaction-thanks': ReactionThanks,
  'rating-love': RatingLove,
  'rating-good': RatingGood,
  'rating-ok': RatingOk,
  'rating-pass': RatingPass,
  'milestone-first-smile': MilestoneFirstSmile,
  'milestone-first-roll': MilestoneFirstRoll,
  'milestone-first-sit': MilestoneFirstSit,
  'milestone-first-crawl': MilestoneFirstCrawl,
  'milestone-first-stand': MilestoneFirstStand,
  'milestone-first-steps': MilestoneFirstSteps,
  'milestone-first-word': MilestoneFirstWord,
  'milestone-first-tooth': MilestoneFirstTooth,
  'tpl-baby': TplBaby,
  'tpl-travel': TplTravel,
  'tpl-daily': TplDaily,
  'tpl-reading': TplReading,
  'tpl-career': TplCareer,
};
