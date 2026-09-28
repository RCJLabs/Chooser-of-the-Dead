import { registerSW } from 'virtual:pwa-register';
import type { Platform } from '../index';
import { noAchievements, shareWithFallback } from '../share';
import { openStore } from '../storage';

/**
 * The whole game on Pages (web-full) is unlisted, so its shares carry no link to it (docs/tech-spec.md §65). The MODE
 * check is replaced at build time.
 */
const UNLISTED = import.meta.env.MODE === 'web-full';

/** GitHub Pages builds (PWAs). Updates wait for the player (registerType: 'prompt'). */
export const platform: Platform = {
  kind: 'web',
  share: shareWithFallback,
  shareUrl: () => (UNLISTED ? undefined : new URL(import.meta.env.BASE_URL, location.origin).href),
  openStore: (name) => openStore(name),
  watchForUpdate: (ready) => registerSW({ onNeedRefresh: ready }),
  unlockAchievement: noAchievements,
};
