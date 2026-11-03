import { describe, expect, it } from 'vitest';
import { avatarHue, avatarInitials, mosaicMembers } from './avatarName';
import { mosaicLayout } from './mosaic';

describe('avatarHue', () => {
  it('is stable for the same name', () => {
    expect(avatarHue('fishtank')).toBe(avatarHue('fishtank'));
    expect(avatarHue('肥鱼')).toBe(avatarHue('肥鱼'));
  });

  it('stays inside the hue circle', () => {
    for (const name of ['a', '肥鱼', 'G哥', 'C酱', '', 'a very long display name']) {
      const h = avatarHue(name);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it('separates different people', () => {
    const hues = ['肥鱼', 'G哥', 'C酱', '大豆包'].map(avatarHue);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('treats an empty name as a single placeholder', () => {
    expect(avatarHue('')).toBe(avatarHue('?'));
  });
});

describe('avatarInitials', () => {
  it('takes one glyph for CJK names', () => {
    expect(avatarInitials('肥鱼')).toBe('肥');
    expect(avatarInitials('大豆包')).toBe('大');
  });

  it('takes two initials across word boundaries', () => {
    expect(avatarInitials('jit cow')).toBe('JC');
    expect(avatarInitials('cc-connect')).toBe('CC');
  });

  it('falls back to the first two characters', () => {
    expect(avatarInitials('alpha')).toBe('AL');
  });

  it('never returns an empty glyph', () => {
    expect(avatarInitials('')).toBe('?');
    expect(avatarInitials('   ')).toBe('?');
  });
});

describe('mosaicMembers', () => {
  it('drops blanks and keeps at most four', () => {
    expect(mosaicMembers(['a', ' ', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('mosaicLayout', () => {
  it('fills a 2x2 grid without overlapping cells', () => {
    for (const count of [1, 2, 3, 4]) {
      const cells = mosaicLayout(count);
      expect(cells.length).toBe(count);
      expect(new Set(cells.map((c) => `${c.col}|${c.row}`)).size).toBe(count);
    }
  });

  it('clamps out-of-range counts', () => {
    expect(mosaicLayout(0).length).toBe(1);
    expect(mosaicLayout(9).length).toBe(4);
  });
});
