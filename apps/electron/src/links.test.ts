import { describe, expect, it } from 'vitest';
import { isAllowedExternal } from './links';

describe('links the game may open in the system browser', () => {
  it('opens the game’s own GitHub pages and its Steam store page', () => {
    expect(isAllowedExternal('https://github.com/RCJLabs/Vikings-R-Us/issues/new?template=bug.yml&title=x')).toBe(true);
    expect(isAllowedExternal('https://github.com/rcjlabs/vikings-r-us/blob/main/docs/privacy.md')).toBe(true);
    expect(isAllowedExternal('https://store.steampowered.com/app/480/')).toBe(true);
    // The source, which the code's licence says to offer.
    expect(isAllowedExternal('https://github.com/RCJLabs/Vikings-R-Us')).toBe(true);
  });

  it('opens nothing else', () => {
    for (const url of [
      'https://github.com/RCJLabs/Vikings-R-Us-fake/issues',
      'https://github.com/someone/else',
      'http://github.com/RCJLabs/Vikings-R-Us/issues',
      'https://github.com.evil.example/RCJLabs/Vikings-R-Us/',
      'https://user:pass@github.com/RCJLabs/Vikings-R-Us/issues',
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
