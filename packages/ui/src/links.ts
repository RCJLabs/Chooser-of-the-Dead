/**
 * Where the alpha's outside links point. Set at build time with VITE_* env
 * variables; `window.cotsConfig` overrides them (the e2e tests use it to
 * point telemetry at a fake endpoint). An unset link hides its button.
 */
export interface Links {
  /** GitHub's "new issue" page; reports and feedback open issue forms there. */
  readonly issues: string | undefined;
  readonly community: string | undefined;
  readonly steam: string | undefined;
  /** The opt-in telemetry endpoint (a Cloudflare Worker). Unset means no telemetry UI at all. */
  readonly telemetry: string | undefined;
  readonly privacy: string | undefined;
}

const REPO = 'https://github.com/RCJLabs/Chooser-of-the-Dead';
const env = import.meta.env as Record<string, string | undefined>;
const overrides = (globalThis as { cotsConfig?: Partial<Links> }).cotsConfig ?? {};
const clean = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);

export const links: Links = {
  issues: clean(overrides.issues ?? env.VITE_ISSUES_URL ?? `${REPO}/issues/new`),
  community: clean(overrides.community ?? env.VITE_COMMUNITY_URL),
  steam: clean(overrides.steam ?? env.VITE_STEAM_URL),
  telemetry: clean(overrides.telemetry ?? env.VITE_TELEMETRY_URL),
  privacy: clean(overrides.privacy ?? env.VITE_PRIVACY_URL ?? `${REPO}/blob/main/docs/privacy.md`),
};

/** A GitHub issue form, with text fields filled in by their ids (dropdowns and checkboxes can't be). */
export function issueFormUrl(
  template: string,
  fields: Readonly<Record<string, string>>,
  title?: string,
): string | undefined {
  if (!links.issues) return undefined;
  const url = new URL(links.issues);
  url.searchParams.set('template', template);
  if (title) url.searchParams.set('title', title);
  for (const [id, value] of Object.entries(fields)) url.searchParams.set(id, value);
  return url.href;
}
