/** Layout for the group avatar mosaic: how many cells and how they are placed.
    Unit-tested directly (no DOM) so the shape rules stay honest. */
export interface MosaicCell {
  col: string;
  row: string;
}

export function mosaicLayout(count: number): MosaicCell[] {
  const n = Math.max(0, Math.min(4, count));
  if (n <= 1) return [{ col: '1 / 2', row: '1 / 2' }];
  if (n === 2) {
    return [
      { col: '1 / 2', row: '1 / 3' },
      { col: '2 / 3', row: '1 / 3' },
    ];
  }
  if (n === 3) {
    return [
      { col: '1 / 2', row: '1 / 3' },
      { col: '2 / 3', row: '1 / 2' },
      { col: '2 / 3', row: '2 / 3' },
    ];
  }
  return [
    { col: '1 / 2', row: '1 / 2' },
    { col: '2 / 3', row: '1 / 2' },
    { col: '1 / 2', row: '2 / 3' },
    { col: '2 / 3', row: '2 / 3' },
  ];
}
