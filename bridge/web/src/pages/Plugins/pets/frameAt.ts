/**
 * 桌宠逐帧播放 (#416-C): 一张精灵图里第 n 帧贴在哪、一帧亮多久。纯函数，不碰 DOM，单测直接喂数。
 *
 * 切图不用像素偏移，用 background-position 的百分比：百分比的含义是「(元素宽 - 图宽) 的几成」，
 * 所以把图设成 columns 倍元素宽、rows 倍元素高之后，第 c 列正好的位置是 c/(columns-1)，
 * 与元素最终多大无关——卡片里整张图缩成一片小点，就是因为直接塞原图没有这一步。
 */

/** 精灵图规格：包里的 actions.json / manifest.json 直接给这几项。 */
export interface SpriteSheet {
  /** 单帧宽高（像素）。只用来定长宽比，切图本身走百分比，元素多大都能对齐。 */
  frameWidth: number
  frameHeight: number
  /** 一行几帧。 */
  columns: number
  /** 一共几帧——不是列数乘行数，最后一帧往往不满一行。 */
  frames: number
}

export interface FrameBox {
  /** 循环后的帧号（0 .. frames-1）。 */
  frame: number
  column: number
  row: number
  /** 整张图占几行，给 background-size 用（最后一帧不满一行也算一行）。 */
  rows: number
  /** background-position-x 的百分比，0..100。 */
  x: number
  /** background-position-y 的百分比，0..100。 */
  y: number
}

/**
 * 第 index 帧的位置。超出末尾就绕回开头（按 fps 一直播下去，不自己停），负数也从末尾往前数。
 */
export function frameAt(index: number, sheet: SpriteSheet): FrameBox {
  const columns = Math.max(1, Math.floor(sheet.columns))
  const frames = Math.max(1, Math.floor(sheet.frames))
  const rows = Math.ceil(frames / columns)
  const frame = ((Math.floor(index) % frames) + frames) % frames
  const column = frame % columns
  const row = Math.floor(frame / columns)
  // 只有一列/一行时没有可移动的余量，除零也算 0。
  const x = columns > 1 ? (column / (columns - 1)) * 100 : 0
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0
  return { frame, column, row, rows, x, y };
}

/** 一帧多少毫秒。fps 不是正数时不播（返回 0），交给调用方只显示第一帧。 */
export function frameIntervalMs(fps: number): number {
  return fps > 0 ? 1000 / fps : 0;
}
