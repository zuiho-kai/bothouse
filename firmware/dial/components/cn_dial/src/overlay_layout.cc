#include "cn_dial/overlay_layout.h"

#include <algorithm>
#include <cmath>

namespace cn_dial {

OverlaySizes MakeOverlaySizes(const DialMetrics& m) {
    namespace L = layout;
    OverlaySizes z{};
    z.name_top = m.px(L::kNameTagTop);
    z.name_dot = m.px(L::kNameTagDot);
    z.name_glow_extra = m.px(L::kNameTagGlowExtra);
    z.pad_hor = m.px(L::kPillPadHor);
    z.pad_ver = m.px(L::kPillPadVer);
    z.gap = m.px(L::kPillGap);
    z.chip_bottom = m.px(L::kStatusChipBottom);
    z.bar_w = m.px(L::kStatusChipBarWidth);
    z.bar_h = m.px(L::kStatusChipBarHeight);
    z.bar_gap = m.px(L::kStatusChipBarGap);
    z.bar_r = m.px(L::kStatusChipBarRadius);
    z.dot = m.px(L::kStatusChipDotSize);
    z.dot_gap = m.px(L::kStatusChipDotGap);
    z.dot_jump = m.px(L::kStatusChipDotJump);
    z.stop = m.px(L::kStatusChipStopSize);
    z.stop_r = m.px(L::kStatusChipStopRadius);
    z.arc_d = m.px(L::kBatteryArcDiameter);
    z.arc_w = m.px(L::kBatteryArcWidth);
    z.arc_backing_w = m.px(L::kBatteryArcBackingWidth);
    z.bubble_w = m.px(L::kSpeechBubbleWidth);
    z.bubble_min_h = m.px(L::kSpeechBubbleHeight);
    z.bubble_bottom = m.px(L::kSpeechBubbleBottom);
    z.bubble_r = m.px(L::kSpeechBubbleRadius);
    z.text_w = m.px(L::kSpeechBubbleTextWidth);
    z.text_min_h = m.px(L::kSpeechBubbleTextHeight);
    z.text_pad = m.px(L::kSpeechBubbleTextPad);
    return z;
}

BubbleBox Bubble(const DialMetrics& m, const OverlaySizes& z, int line_h_px) {
    BubbleBox b{};
    b.text_w = z.text_w;
    b.text_h = m.text_box_h(layout::kSpeechBubbleTextHeight, layout::kSpeechBubbleText, line_h_px);
    b.w = z.bubble_w;
    b.h = std::max(z.bubble_min_h, b.text_h + z.text_pad);
    b.r = z.bubble_r;
    b.x = m.mid_x(b.w);
    b.y = m.bottom_mid_y(z.bubble_bottom, b.h);
    return b;
}

int NameTagY(const DialMetrics& m, const OverlaySizes& z, int w, int h) {
    namespace L = layout;
    int y = m.top_mid_y(z.name_top);
    const float fit_r = m.k() * (L::kBatteryArcDiameter.design / 2 - L::kBatteryArcBackingWidth.design);
    const float a = std::max(0.0f, w / 2.0f - h / 2.0f), r = h / 2.0f, room = fit_r - r;
    if (room > a) y = std::max(y, (int)ceilf(m.center_y() - sqrtf(room * room - a * a) - r));
    return y;
}

}  // namespace cn_dial
