/** Subsequence fuzzy match for the command palette.
    Returns -1 when the query is not a subsequence of the text, otherwise a score where a match at
    the start and consecutive characters score higher. Pure function, unit-tested. */
export function fuzzyScore(text: string, query: string): number {
  const q = (query || '').trim().toLowerCase().replace(/^\//, '');
  if (!q) return 0;
  const t = (text || '').toLowerCase().replace(/^\//, '');
  let score = 0;
  let from = 0;
  let prevHit = -2;
  for (const ch of q) {
    const hit = t.indexOf(ch, from);
    if (hit < 0) return -1;
    score += 1;
    if (hit === prevHit + 1) score += 2;
    if (hit === 0) score += 3;
    prevHit = hit;
    from = hit + 1;
  }
  return score;
}
