import { describe, expect, it } from 'vitest';
import { dshMemberId, dshOnlyRows } from './dshMerge';

describe('dshMemberId', () => {
  it('reads the member id out of a DSH row name', () => {
    expect(dshMemberId('dsh:deep')).toBe('deep');
    expect(dshMemberId('dsh:')).toBe('');
  });
  it('returns empty for a bridge role name', () => {
    expect(dshMemberId('deep')).toBe('');
    expect(dshMemberId('dshdeep')).toBe('');
  });
});

describe('dshOnlyRows', () => {
  it('drops DSH members that are already bridge projects, keeps the others', () => {
    const rows = [
      { name: 'dsh:cjiang', display_name: 'C酱' },
      { name: 'dsh:deep', display_name: '肥鱼' },
      { name: 'dsh:ds1', display_name: 'DSH-1' },
    ];
    expect(dshOnlyRows(rows, ['cjiang', 'deep', 'gge']).map((r) => r.name)).toEqual(['dsh:ds1']);
  });

  it('keeps every row on a DSH-only install (no bridge projects)', () => {
    const rows = [{ name: 'dsh:cjiang' }, { name: 'dsh:deep' }];
    expect(dshOnlyRows(rows, []).map((r) => r.name)).toEqual(['dsh:cjiang', 'dsh:deep']);
  });

  it('keeps a row whose id is empty rather than dropping it silently', () => {
    expect(dshOnlyRows([{ name: 'dsh:' }], ['']).map((r) => r.name)).toEqual(['dsh:']);
  });

  it('does not mutate the input', () => {
    const rows = [{ name: 'dsh:deep' }];
    dshOnlyRows(rows, ['deep']);
    expect(rows).toHaveLength(1);
  });
});