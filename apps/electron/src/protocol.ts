import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

/*
 * The game, served to its window from the app's own files at `app://game/` (docs/tech-spec.md §8.1). A privileged,
 * standard scheme gives the page a real origin (its localStorage, fetch of its own files) without a local web server
 * or file:// URLs. Nothing else is ever loaded: the content security policy allows the game's own files only.
 */

export const SCHEME = 'app';
export const HOST = 'game';
export const ORIGIN = `${SCHEME}://${HOST}`;

/**
 * No remote content, ever. Styles may be inline (the art's SVG carries style attributes); scripts may not. Blob and
 * data URLs for the images and sound the game makes as it runs.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export const contentType = (file: string): string => TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * The file an `app://game/...` URL names inside the game's folder, or null: another host, a path that would leave
 * the folder, or no such file. The folder's root is its index.html.
 */
export function resolveAsset(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${SCHEME}:` || parsed.host !== HOST) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  const rel = normalize(path === '/' || path === '' ? '/index.html' : path).replace(/^[/\\]+/, '');
  const base = normalize(root);
  const file = join(base, rel);
  // The URL parser and normalize() already keep a path from climbing out; this is the backstop if either changes.
  if (file !== base && !file.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  try {
    return existsSync(file) && statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}
