/*
 * Links the game may open in the player's own browser (docs/tech-spec.md §62): the issue forms and the privacy note
 * on the game's GitHub, and its Steam store page. Nothing opens inside the game's window, and nothing else leaves it.
 */

const ALLOWED: readonly { readonly origin: string; readonly path: string }[] = [
  { origin: 'https://github.com', path: '/rcjlabs/vikings-r-us' },
  { origin: 'https://store.steampowered.com', path: '' },
];

/** Whether `url` may be handed to the system's browser. */
export function isAllowedExternal(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return false;
  // GitHub's owner and repository names are case-insensitive; the rest of the path isn't looked at.
  const path = u.pathname.toLowerCase();
  return ALLOWED.some((a) => u.origin === a.origin && (path === a.path || path.startsWith(`${a.path}/`)));
}
