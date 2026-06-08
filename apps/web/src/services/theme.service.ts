import { Service } from '@rabjs/react';
import { getThemeChoice, setThemeChoice, subscribeSystemTheme, type ThemeChoice } from '@/lib/theme';

/** 全局主题态（spec §3.2）。分享页恒浅规则留在 lib/theme 的 applyTheme 里，不进 Service。 */
export class ThemeService extends Service {
  choice: ThemeChoice = getThemeChoice();

  constructor() {
    super();
    // system 跟随订阅挂在全局单例构造：应用存续期不解绑（原 App.tsx 的 effect 搬家）
    subscribeSystemTheme();
  }

  setChoice(choice: ThemeChoice): void {
    setThemeChoice(choice);
    this.choice = choice;
  }
}
