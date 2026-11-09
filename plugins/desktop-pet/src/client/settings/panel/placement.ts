/**
 * 设置页浮层的定位计算：把触发器的实测矩形与视口尺寸换算成浮层的 fixed 坐标。
 * 下方放不下且上方更宽裕时翻到上方，左右钳制在视口内，并给出高度上限——浮层自身不进文档流。
 * 纯函数，不读 `window`：矩形与视口由调用方传入，便于单测与将来的视口外定位。
 * 模型选择器与通用单选下拉共用这一份算术，差异只经 {@link PlacementOptions} 传入，不在调用方各自复制。
 * @module dsh-pet/src/client/settings/panel/placement
 */

/** 浮层与触发器、视口边缘之间的间距。 */
const PANEL_GAP_PX = 12;
/** 浮层离触发器的偏移，避免贴着触发器边框。 */
const PANEL_OFFSET_PX = 4;
/** 视口余量：浮层左右各留 8px，不贴死屏幕边。 */
const EDGE_MARGIN_PX = 8;
/** 视口更窄时浮层宽度的兜底余量。 */
const VIEWPORT_INSET_PX = 16;
/** 视口窄到连它都装不下时，仍按这个宽度渲染。 */
const MIN_AVAILABLE_WIDTH_PX = 200;

/** 触发器的实测矩形，语义同 `DOMRect` 的这几个字段。 */
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/** 视口尺寸，通常直接取 `window.innerWidth` / `innerHeight`。 */
export interface Viewport {
  width: number;
  height: number;
}

/** 浮层的 fixed 定位与尺寸；`top` 与 `bottom` 只有一个有值。 */
export interface PanelPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** 按浮层内容覆盖的默认值；缺省即模型选择器的取值。 */
export interface PlacementOptions {
  /** 浮层宽度下限（px）：模型清单要装下「服务商 + 模型」两段文字，故默认 240；单行下拉传 0 以跟触发器等宽。 */
  minWidthPx?: number;
  /** 浮层宽度上限（px），默认 420：再宽会横跨整个设置页。 */
  maxWidthPx?: number;
  /** 浮层高度上限（px），默认 360：超出后清单自己滚动。 */
  maxHeightPx?: number;
  /** 下方可用空间小于它（px）才考虑翻到上方，默认 240：否则即使靠近底部也优先向下展开。 */
  flipThresholdPx?: number;
}

/**
 * 算出浮层该贴在哪。
 *
 * @param anchor - 触发器的实测矩形。
 * @param viewport - 视口尺寸。
 * @param options - 宽度与翻面的阈值覆盖，见 {@link PlacementOptions}。
 * @returns 浮层定位；上方空间更宽裕时给出 `bottom`，否则给出 `top`。
 */
export function computePanelPlacement(
  anchor: AnchorRect,
  viewport: Viewport,
  options: PlacementOptions = {},
): PanelPosition {
  const minWidth = options.minWidthPx ?? 240;
  const maxWidth = options.maxWidthPx ?? 420;
  const maxHeight = options.maxHeightPx ?? 360;
  const flipThreshold = options.flipThresholdPx ?? 240;
  const below = viewport.height - anchor.bottom - PANEL_GAP_PX;
  const above = anchor.top - PANEL_GAP_PX;
  const available = Math.max(MIN_AVAILABLE_WIDTH_PX, Math.min(maxWidth, viewport.width - VIEWPORT_INSET_PX));
  const width = Math.min(Math.max(anchor.width, minWidth), available);
  const left = Math.max(EDGE_MARGIN_PX, Math.min(anchor.left, viewport.width - width - EDGE_MARGIN_PX));
  // 下方窄到放不下且上方更宽裕才翻上去：靠近底部的触发器向下展开才不会盖住上面的字段。
  const openUp = below < flipThreshold && above > below;
  return openUp
    ? { left, bottom: viewport.height - anchor.top + PANEL_OFFSET_PX, width, maxHeight: Math.min(maxHeight, above) }
    : { left, top: anchor.bottom + PANEL_OFFSET_PX, width, maxHeight: Math.min(maxHeight, below) };
}
