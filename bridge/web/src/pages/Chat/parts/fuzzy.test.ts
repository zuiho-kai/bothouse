import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('accepts an empty query for everything', () => {
    expect(fuzzyScore('/model', '')).toBe(0);
    expect(fuzzyScore('/model', '   ')).toBe(0);
  });

  it('matches a plain substring', () => {
    expect(fuzzyScore('/model', 'model')).toBeGreaterThan(0);
  });

  it('matches a subsequence', () => {
    expect(fuzzyScore('/delete-mode', 'dlm')).toBeGreaterThan(0);
  });

  it('rejects a query that is not a subsequence', () => {
    expect(fuzzyScore('/model', 'xyz')).toBe(-1);
    expect(fuzzyScore('/model', 'ledom')).toBe(-1);
  });

  it('scores a prefix hit above a mid-string hit', () => {
    expect(fuzzyScore('/model', 'mo')).toBeGreaterThan(fuzzyScore('/model', 'de'));
  });

  it('ignores case and a leading slash in the query', () => {
    expect(fuzzyScore('/model', '/MODEL')).toBe(fuzzyScore('/model', 'model'));
  });
});
