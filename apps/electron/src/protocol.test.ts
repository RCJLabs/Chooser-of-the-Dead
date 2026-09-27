import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP, contentType, resolveAsset } from './protocol';

function game(): string {
  const base = mkdtempSync(join(tmpdir(), 'cots-proto-'));
  const root = join(base, 'game');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html>');
  writeFileSync(join(root, 'assets', 'index-abc.js'), '');
  writeFileSync(join(root, 'assets', 'a b.css'), '');
  // A file beside the game's folder, which no URL may reach.
  writeFileSync(join(base, 'secret.txt'), 'no');
  mkdirSync(join(base, 'game-other'));
  writeFileSync(join(base, 'game-other', 'x.js'), '');
  return root;
}

describe('the game served at app://game', () => {
  it('serves the game’s own files, its root as index.html', () => {
    const root = game();
    expect(resolveAsset(root, 'app://game/')).toBe(join(root, 'index.html'));
    expect(resolveAsset(root, 'app://game/index.html')).toBe(join(root, 'index.html'));
    expect(resolveAsset(root, 'app://game/assets/index-abc.js?v=1#x')).toBe(join(root, 'assets', 'index-abc.js'));
    expect(resolveAsset(root, 'app://game/assets/a%20b.css')).toBe(join(root, 'assets', 'a b.css'));
  });

  it('serves nothing outside the game’s folder, from another host, or that isn’t a file', () => {
    const root = game();
    for (const url of [
      'app://game/../secret.txt',
      'app://game/%2e%2e/secret.txt',
      'app://game/assets/%2e%2e/%2e%2e/secret.txt',
      'app://game/%2e%2e%5csecret.txt',
      'app://game/..%2f..%2fsecret.txt',
      'app://game/../game-other/x.js',
      'app://game/%00index.html',
      'app://game/%E0%A4%A',
      'app://game/assets',
      'app://game/missing.js',
      'app://other/index.html',
      'file:///etc/passwd',
      'https://game/index.html',
      'not a url',
    ]) {
      expect(resolveAsset(root, url), url).toBeNull();
    }
  });

  it('names each file’s type, and sniffs nothing', () => {
    expect(contentType('x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('x/a.JS')).toBe('text/javascript; charset=utf-8');
    expect(contentType('x/f.woff2')).toBe('font/woff2');
    expect(contentType('x/s.ogg')).toBe('audio/ogg');
    expect(contentType('x/unknown.bin')).toBe('application/octet-stream');
  });

  it('allows the game’s own files and nothing remote: no inline or evaluated scripts', () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("script-src 'self';");
    expect(CSP).toContain("connect-src 'self'");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).not.toMatch(/https?:|\*|unsafe-eval/);
    expect(CSP.match(/script-src[^;]*/)?.[0]).not.toContain('unsafe-inline');
  });
});
