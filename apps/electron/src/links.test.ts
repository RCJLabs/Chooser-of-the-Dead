import { describe, expect, it } from 'vitest';
import { isAllowedExternal } from './links';

describe('links the game may open in the system browser', () => {
  it('opens the game’s own GitHub pages and its Steam store page', () => {
    expect(
      isAllowedExternal('https://github.com/RCJLabs/Chooser-of-the-Dead/issues/new?template=bug.yml&title=x'),
    ).toBe(true);
    expect(isAllowedExternal('https://github.com/rcjlabs/chooser-of-the-dead/blob/main/docs/privacy.md')).toBe(true);
    expect(isAllowedExternal('https://store.steampowered.com/app/480/')).toBe(true);
    // The source, which the code's licence says to offer.
    expect(isAllowedExternal('https://github.com/RCJLabs/Chooser-of-the-Dead')).toBe(true);
  });

  it('opens nothing else', () => {
    for (const url of [
      'https://github.com/RCJLabs/Chooser-of-the-Dead-fake/issues',
      'https://github.com/someone/else',
      'http://github.com/RCJLabs/Chooser-of-the-Dead/issues',
      'https://github.com.evil.example/RCJLabs/Chooser-of-the-Dead/',
      'https://user:pass@github.com/RCJLabs/Chooser-of-the-Dead/issues',
      'https://store.steampowered.com.evil.example/app/1',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'steam://run/480',
      'app://game/index.html',
      'not a url',
    ]) {
      expect(isAllowedExternal(url), url).toBe(false);
    }
  });
});
