import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { ThemeScheme } from './theme';

/** 应用内主题三档（对齐 web `ThemeChoice` / ThemeToggle）。 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICE_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

const THEME_KEY = 'moment.theme.choice';

let currentChoice: ThemeChoice = 'system';
const listeners = new Set<(choice: ThemeChoice) => void>();

export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function resolveThemeScheme(
  choice: ThemeChoice,
  system: ThemeScheme | null | undefined,
): ThemeScheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return system === 'dark' ? 'dark' : 'light';
}

/** `Appearance.setColorScheme` 入参：null = 跟随系统。 */
export function colorSchemeOverride(choice: ThemeChoice): ThemeScheme | null {
  return choice === 'system' ? null : choice;
}

export function getThemeChoice(): ThemeChoice {
  return currentChoice;
}

export function subscribeThemeChoice(fn: (choice: ThemeChoice) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(choice: ThemeChoice): void {
  currentChoice = choice;
  for (const fn of [...listeners]) fn(choice);
}

export function applyThemeChoice(choice: ThemeChoice): void {
  emit(choice);
  Appearance.setColorScheme(colorSchemeOverride(choice));
}

/** 同步切换并持久化。写失败只影响下次冷启动，本会话仍生效。 */
export function setThemeChoice(choice: ThemeChoice): void {
  applyThemeChoice(choice);
  void SecureStore.setItemAsync(THEME_KEY, choice).catch(() => undefined);
}

/** 冷启动读盘。缺省 / 损坏值按 system。 */
export async function hydrateThemeChoice(): Promise<void> {
  const raw = await SecureStore.getItemAsync(THEME_KEY).catch(() => null);
  applyThemeChoice(parseThemeChoice(raw));
}
