import type { ComponentType } from 'react';
import type { SvgProps } from 'react-native-svg';
import type { IconKey } from '@moment/icons';
import MoodJoy from '@moment/icons/svg/mood-joy.svg';
import MoodLove from '@moment/icons/svg/mood-love.svg';
import MoodCry from '@moment/icons/svg/mood-cry.svg';
import MoodAngry from '@moment/icons/svg/mood-angry.svg';
import MoodSleepy from '@moment/icons/svg/mood-sleepy.svg';
import ReactionLike from '@moment/icons/svg/reaction-like.svg';
import ReactionLove from '@moment/icons/svg/reaction-love.svg';
import ReactionLaugh from '@moment/icons/svg/reaction-laugh.svg';
import ReactionWow from '@moment/icons/svg/reaction-wow.svg';
import ReactionSad from '@moment/icons/svg/reaction-sad.svg';
import ReactionCelebrate from '@moment/icons/svg/reaction-celebrate.svg';
import ReactionClap from '@moment/icons/svg/reaction-clap.svg';
import ReactionStrong from '@moment/icons/svg/reaction-strong.svg';
import ReactionThanks from '@moment/icons/svg/reaction-thanks.svg';
import RatingLove from '@moment/icons/svg/rating-love.svg';
import RatingGood from '@moment/icons/svg/rating-good.svg';
import RatingOk from '@moment/icons/svg/rating-ok.svg';
import RatingPass from '@moment/icons/svg/rating-pass.svg';
import MilestoneFirstSmile from '@moment/icons/svg/milestone-first-smile.svg';
import MilestoneFirstRoll from '@moment/icons/svg/milestone-first-roll.svg';
import MilestoneFirstSit from '@moment/icons/svg/milestone-first-sit.svg';
import MilestoneFirstCrawl from '@moment/icons/svg/milestone-first-crawl.svg';
import MilestoneFirstStand from '@moment/icons/svg/milestone-first-stand.svg';
import MilestoneFirstSteps from '@moment/icons/svg/milestone-first-steps.svg';
import MilestoneFirstWord from '@moment/icons/svg/milestone-first-word.svg';
import MilestoneFirstTooth from '@moment/icons/svg/milestone-first-tooth.svg';
import TplBaby from '@moment/icons/svg/tpl-baby.svg';
import TplTravel from '@moment/icons/svg/tpl-travel.svg';
import TplDaily from '@moment/icons/svg/tpl-daily.svg';
import TplReading from '@moment/icons/svg/tpl-reading.svg';
import TplCareer from '@moment/icons/svg/tpl-career.svg';

type SvgComponent = ComponentType<SvgProps>;

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
