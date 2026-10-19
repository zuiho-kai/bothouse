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

namespace {

struct Rect {
    int x, y, w, h;
};

Rect RefNamePill(const DialMetrics& m, const OverlaySizes& z, PillFont f, bool work) {
    const int w = NamePillW(z, kRefNameGlyphs * f.glyph_w, work ? kWorkGlyphs * f.glyph_w : 0);
    const int h = NamePillH(z, f.line_h);
    return {m.mid_x(w), NameTagY(m, z, w, h), w, h};
}

bool InSafe(const DialMetrics& m, const Rect& b) { return m.InSafeArea(b.x, b.y, b.w, b.h, b.h / 2); }

}  // namespace

int NameTagMaxW(const DialMetrics& m, const OverlaySizes& z, PillFont f) {
    namespace L = layout;
    const Rect ref = RefNamePill(m, z, f, true);
    const float fit_r = m.k() * (L::kBatteryArcDiameter.design / 2 - L::kBatteryArcBackingWidth.design);
    const float r = ref.h / 2.0f, room = fit_r - r, dy = m.center_y() - (ref.y + r);
    if (room <= std::fabs(dy)) return ref.w;   // the reference does not fit either: no wider than it
    const int w = (int)floorf(2 * (sqrtf(room * room - dy * dy) + r));
    return std::max(ref.w, w);
}

int NameLabelMaxW(const DialMetrics& m, const OverlaySizes& z, PillFont f, int work_w) {
    return std::max(f.glyph_w, NameTagMaxW(m, z, f) - NamePillW(z, 0, work_w));
}

bool OverlayFits(const DialMetrics& m, PillFont f) {
    const OverlaySizes z = MakeOverlaySizes(m);
    const int chip_w = 2 * z.pad_hor + z.bars_w() + z.gap + kChipGlyphs * f.glyph_w;
    const int chip_h = 2 * z.pad_ver + std::max({f.line_h, z.bar_h, z.dots_h(), z.stop});
    const Rect chip{m.mid_x(chip_w), ChipY(m, z, chip_h), chip_w, chip_h};
    const BubbleBox b = Bubble(m, z, f.line_h);
    if (!InSafe(m, chip) || !m.InSafeArea(b.x, b.y, b.w, b.h, b.r)) return false;
    for (bool work : {false, true}) {
        const Rect n = RefNamePill(m, z, f, work);
        if (!InSafe(m, n) || n.y + n.h > chip.y || n.y + n.h > b.y) return false;
    }
    return true;
}

bool Supported(const DialMetrics& m, PillFont f) {
    return m.canvas() >= layout::kMinShortSide && f.glyph_w > 0 && f.line_h > 0 && OverlayFits(m, f);
}

}  // namespace cn_dial
