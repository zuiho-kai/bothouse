// Host tests of cn_dial (CI job dial-metrics). No framework: each CHECK prints on failure and the
// process exits non-zero if any failed.
#include "cn_dial/dial_layout_v1.h"
#include "cn_dial/dial_metrics.h"
#include "cn_dial/overlay_layout.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

using namespace cn_dial;
namespace L = cn_dial::layout;

static int g_fail = 0, g_pass = 0;
#define CHECK_EQ(a, b)                                                                              \
    do {                                                                                            \
        long long va_ = (long long)(a), vb_ = (long long)(b);                                      \
        if (va_ != vb_) {                                                                           \
            std::printf("FAIL %s:%d  %s = %lld, want %s = %lld\n", __FILE__, __LINE__, #a, va_, #b, vb_); \
            g_fail++;                                                                               \
        } else {                                                                                    \
            g_pass++;                                                                               \
        }                                                                                           \
    } while (0)
#define CHECK(c)                                                                \
    do {                                                                        \
        if (!(c)) {                                                             \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c);            \
            g_fail++;                                                           \
        } else {                                                                \
            g_pass++;                                                           \
        }                                                                       \
    } while (0)

// Line height of the xiaozhi Noto Sans fonts (managed_components/78__xiaozhi-fonts/src/
// font_noto_sans_basic_<px>_*.c, `.line_height`): 14 -> 16, 16 -> 23, 20 -> 28, 30 -> 43.
static int LineH(int font_px) {
    switch (font_px) {
        case 14: return 16;
        case 16: return 23;
        case 20: return 28;
        case 30: return 43;
    }
    return 0;
}

// The speech bubble as cn_dial_lvgl DialOverlay builds it (cn_dial::Bubble): text box =
// max(design 40, lines * line height), bubble = max(design 58, text box + 18).
struct Box { int x, y, w, h, r; };
static Box Bubble(const DialMetrics& m) {
    const OverlaySizes z = MakeOverlaySizes(m);
    const BubbleBox b = cn_dial::Bubble(m, z, LineH(m.font_px(L::kSpeechBubbleText)));
    return {b.x, b.y, b.w, b.h, b.r};
}

// The name tag and status chip as DialOverlay builds them (conest patch 0006 Pill(): content-sized
// flex row, no border, pad_hor + contents + pad_hor wide, pad_ver + tallest child + pad_ver high,
// fully rounded r = h/2). Name tag: dot + gap + name (+ gap + work status); status chip (widest
// state): 5 bars + gap + text. Text is modelled as CJK glyphs as wide as the pill font
// (pill.text, the theme font): the name as 4 ("等待主机", the longest fixed string), the work
// status 「· 工作中」 as 5, the chip text as 3 (「我在听」「想一想」「被打断」, patch 0006 Update()).
static constexpr int kNameGlyphs = 4, kWorkGlyphs = 5, kChipGlyphs = 3;
static Box NamePill(const DialMetrics& m, bool work) {
    const OverlaySizes z = MakeOverlaySizes(m);
    const int f = m.font_px(L::kPillText);
    int w = 2 * z.pad_hor + z.name_dot + z.gap + kNameGlyphs * f;
    if (work) w += z.gap + kWorkGlyphs * f;
    const int h = 2 * z.pad_ver + std::max(LineH(f), z.name_dot);
    return {m.mid_x(w), NameTagY(m, z, w, h), w, h, h / 2};
}
static Box StatusPill(const DialMetrics& m) {
    const OverlaySizes z = MakeOverlaySizes(m);
    const int f = m.font_px(L::kPillText);
    const int w = 2 * z.pad_hor + z.bars_w() + z.gap + kChipGlyphs * f;
    const int h = 2 * z.pad_ver + std::max({LineH(f), z.bar_h, z.dots_h(), z.stop});
    return {m.mid_x(w), ChipY(m, z, h), w, h, h / 2};
}
static bool Inside(const DialMetrics& m, const Box& b) { return m.InSafeArea(b.x, b.y, b.w, b.h, b.r); }
static bool Apart(const Box& top, const Box& bottom) { return top.y + top.h <= bottom.y; }
// Everything drawn on the dial fits: pills and bubble in the safe circle, the name tag (with and
// without the work status) above the status chip and above the speech bubble.
static bool LayoutFits(const DialMetrics& m) {
    const Box s = StatusPill(m), bub = Bubble(m);
    if (!Inside(m, s) || !Inside(m, bub)) return false;
    for (bool work : {false, true}) {
        const Box n = NamePill(m, work);
        if (!Inside(m, n) || !Apart(n, s) || !Apart(n, bub)) return false;
    }
    return true;
}

// Things every screen must satisfy.
static void CommonChecks(const DialMetrics& m, const char* name) {
    std::printf("-- %s: k=%.4f canvas=%d safe_r=%.1f\n", name, m.k(), m.canvas(), m.safe_radius());
    const int fmin = m.profile().font_min_px;
    CHECK(m.font_px(L::kSpeechBubbleText) >= fmin);
    CHECK(m.font_px(L::kWorkStatusText) >= fmin);
    CHECK(LineH(m.font_px(L::kSpeechBubbleText)) > 0);  // a font the board really has
    Box b = Bubble(m);
    std::printf("   bubble x=%d y=%d %dx%d r=%d\n", b.x, b.y, b.w, b.h, b.r);
    CHECK(m.InSafeArea(b.x, b.y, b.w, b.h, b.r));
    // battery arc: centred on the canvas, its outer edge inside the safe circle
    CHECK(m.px(L::kBatteryArcDiameter) / 2.0f <= m.safe_radius());
    // name tag top edge below the canvas top, status chip above the canvas bottom
    CHECK(m.top_mid_y(m.px(L::kNameTagTop)) >= m.canvas_y());
    CHECK(m.bottom_mid_y(m.px(L::kStatusChipBottom), 1) < m.canvas_y() + m.canvas());
    CHECK(m.profile().Valid());
    CHECK(m.Supported());
    CHECK(LayoutFits(m));
}

// W = 466: every conest DECOR.md / patch 0006 / 0010 number comes out unchanged.
static void Test466() {
    // conest 1.75 AMOLED: theme font font_noto_sans_common_14_1 (DECOR.md:72).
    ScreenProfile p{466, 466, Shape::kRound, 14, {14}, 1, kAssetRgb565Raw | kAssetCnas1, Battery::kGauge};
    DialMetrics m(p);
    CHECK_EQ(m.canvas(), 466);
    CHECK_EQ(m.px(L::kBatteryArcDiameter), 456);   // DECOR.md:14 radius 228
    CHECK_EQ(m.px(L::kBatteryArcWidth), 5);        // DECOR.md:16
    CHECK_EQ(m.px(L::kBatteryArcBackingWidth), 8); // DECOR.md:17
    CHECK_EQ(L::kBatteryArcStart, 242);            // DECOR.md:15
    CHECK_EQ(L::kBatteryArcSweep, 56);
    CHECK_EQ(m.px(L::kSpeechBubbleWidth), 300);    // DECOR.md:31
    CHECK_EQ(m.px(L::kSpeechBubbleHeight), 58);
    CHECK_EQ(m.px(L::kSpeechBubbleBottom), 52);
    CHECK_EQ(m.px(L::kSpeechBubbleRadius), 20);    // DECOR.md:32
    CHECK_EQ(m.px(L::kSpeechBubbleTextWidth), 272);  // DECOR.md:33
    CHECK_EQ(m.px(L::kSpeechBubbleTextHeight), 40);
    CHECK_EQ(m.px(L::kNameTagTop), 28);            // DECOR.md:24, patch 0006:90
    CHECK_EQ(m.px(L::kNameTagDot), 10);            // patch 0006:93
    CHECK_EQ(m.px(L::kPillPadHor), 16);            // patch 0006:77-79
    CHECK_EQ(m.px(L::kPillPadVer), 6);
    CHECK_EQ(m.px(L::kPillGap), 8);
    CHECK_EQ(m.px(L::kStatusChipBottom), 30);      // patch 0006:102
    CHECK_EQ(m.px(L::kWorkStatusGap), 8);          // DECOR.md:47
    CHECK_EQ(m.font_px(L::kSpeechBubbleText), 14); // DECOR.md:33
    CHECK_EQ(m.font_px(L::kWorkStatusText), 14);   // DECOR.md:48
    CHECK_EQ(m.font_px(L::kPillText), 14);         // patch 0006 SetTheme: theme font (14 px, DECOR.md:33)
    // The overlay as drawn: every patch 0006 / DECOR.md number unchanged.
    const OverlaySizes z = MakeOverlaySizes(m);
    CHECK_EQ(z.name_top, 28);                      // patch 0006:90
    CHECK_EQ(z.name_dot, 10);                      // patch 0006:93
    CHECK_EQ(z.pad_hor, 16);                       // patch 0006:77-79
    CHECK_EQ(z.pad_ver, 6);
    CHECK_EQ(z.gap, 8);
    CHECK_EQ(z.chip_bottom, 30);                   // patch 0006:102
    CHECK_EQ(z.arc_d, 456);                        // DECOR.md:14-17
    CHECK_EQ(z.arc_w, 5);
    CHECK_EQ(z.arc_backing_w, 8);
    CHECK_EQ(z.bubble_w, 300);                     // DECOR.md:31-33
    CHECK_EQ(z.bubble_bottom, 52);
    CHECK_EQ(z.bubble_r, 20);
    CHECK_EQ(z.text_w, 272);
    // A short name pill ("C酱", patch 0006 default) stays at y=28 (DECOR.md:24 仍在 y=28).
    CHECK_EQ(NameTagY(m, z, 2 * 16 + 10 + 8 + 2 * 14, 6 * 2 + 16), 28);
    // DECOR.md 1: arc ends at x~126/340, y~32; the name pill (x 185-281) stays clear of them.
    CHECK(NamePill(m, false).x >= 126 && NamePill(m, false).x + NamePill(m, false).w <= 340);
    Box b = Bubble(m);                             // two 14 px lines fit the designed 272x40 box
    CHECK_EQ(b.w, 300);
    CHECK_EQ(b.h, 58);
    CHECK_EQ(b.y + b.h, 466 - 52);
    CommonChecks(m, "466 round");
}

// W = 240: every size the role-household dial uses today (rh_dial_display.cc on rh-uplink 37d2212).
static void Test240() {
    // spotpear sp-esp32-s3-1.28-box: BUILTIN_TEXT_FONT font_noto_sans_basic_16_4 (main/CMakeLists.txt:811).
    ScreenProfile p{240, 240, Shape::kRound, 16, {16}, 1, kAssetRgb565Raw, Battery::kUnknown};
    DialMetrics m(p);
    CHECK_EQ(m.canvas(), 240);
    CHECK_EQ(m.canvas_x(), 0);
    CHECK_EQ(m.canvas_y(), 0);
    CHECK(m.center_x() == 240 / 2.0f && m.safe_radius() == 240 / 2.0f);
    // Name tag and status chip are conest's now (patch 0006 design values, scaled; the 240 board's
    // old values stay as min_px floors, design doc 5.3). What changed on this screen vs rh-dial-metrics:
    const OverlaySizes z = MakeOverlaySizes(m);
    CHECK_EQ(z.name_top, 14);       // was 17 = lroundf(240 * 0.07f) (rh_dial.name_tag.top)
    CHECK_EQ(z.chip_bottom, 15);    // was 31 = lroundf(240 * 0.13f) (rh_dial.status_chip.bottom)
    CHECK_EQ(z.pad_ver, 4);         // unchanged (6 * k = 3 -> floor 4)
    CHECK_EQ(z.pad_hor, 12);        // unchanged (16 * k = 8 -> floor 12)
    CHECK_EQ(z.gap, 6);             // unchanged (8 * k = 4 -> floor 6)
    CHECK_EQ(z.name_dot, 7);        // unchanged (10 * k = 5 -> floor 7)
    CHECK_EQ(z.name_glow_extra, 6); // unchanged
    // pill border: was 1 px white 14% (rh_dial.pill.border), now none (patch 0006 Pill())
    CHECK_EQ(z.bar_w, 3);           // bars / dots / stop unchanged (now status_chip.* items)
    CHECK_EQ(z.bar_h, 15);
    CHECK_EQ(z.bar_gap, 3);
    CHECK_EQ(z.bar_r, 2);
    CHECK_EQ(z.dot, 5);
    CHECK_EQ(z.dot_gap, 4);
    CHECK_EQ(z.dot_jump, 5);
    CHECK_EQ(z.stop, 9);
    CHECK_EQ(z.stop_r, 2);
    CHECK_EQ(m.font_px(L::kPillText), 16);  // unchanged: the board's only font
    // New on this screen: speech bubble 155 x 55 (two 16 px lines), 27 px above the bottom.
    const Box bub = Bubble(m);
    CHECK_EQ(bub.w, 155);
    CHECK_EQ(bub.h, 55);
    CHECK_EQ(240 - bub.y - bub.h, 27);
    // The name pill with 「· 工作中」 is too wide for y=14 and moves down (DECOR.md 5).
    CHECK_EQ(NamePill(m, false).y, 14);
    CHECK(NamePill(m, true).y > 14);
    CHECK_EQ(m.px(L::kRhDialRingWidth), 3);        // :405 / :541
    CHECK_EQ(m.px(L::kRhDialHaloMin), 3);          // :72
    CHECK_EQ(m.px(L::kRhDialHaloMax), 5);
    CHECK_EQ(m.px(L::kRhDialGlowMin), 3);
    CHECK_EQ(m.px(L::kRhDialGlowMax), 8);
    CHECK_EQ(m.font_px(L::kSpeechBubbleText), 16); // 14 * 240/466 = 7 -> the board's 16 px floor
    const std::string want =
        "{\"w\":240,\"h\":240,\"shape\":\"round\",\"font_min_px\":16,\"fonts_px\":[16],"
        "\"asset_formats\":[\"rgb565raw\"],\"battery\":\"unknown\"}";
    CHECK(p.ToJson() == want);
    CommonChecks(m, "240 round");
}

// The old inline formulas of rh_dial_display.cc and what replaced them agree for every width the
// board could have (16..1024), so swapping them changes no pixel.
static void TestOldFormulas() {
    for (int W = 16; W <= 1024; W++) {
        ScreenProfile p{W, W, Shape::kRound, 16, {16}, 1, kAssetRgb565Raw, Battery::kUnknown};
        DialMetrics m(p);
        const float k = W / 466.0f;
        CHECK_EQ(m.px(L::kRhDialRingWidth), (int)std::max(2.0f, roundf(6 * k)));        // :405
        CHECK_EQ(m.px(L::kRhDialRingWidth), std::max(2, (int)lroundf(6 * W / 466.0f))); // :541
        // conest_decor.cc S(): max(1, lroundf(px466 * width / 466))
        CHECK_EQ(m.px(L::kBatteryArcDiameter), std::max(1, (int)lroundf(456 * (W / 466.0f))));
    }
}

// A 360 round screen nobody has yet: nothing below the smallest font, the bubble inside the circle.
static void Test360() {
    ScreenProfile p{360, 360, Shape::kRound, 16, {16, 20}, 2, kAssetRgb565Raw, Battery::kNone};
    DialMetrics m(p);
    CHECK_EQ(m.canvas(), 360);
    CHECK_EQ(m.px(L::kBatteryArcDiameter), 352);  // round(456 * 360/466) = 352.27
    CommonChecks(m, "360 round");
}

// A 320 x 240 rectangle: the abstraction is not tied to the two round boards.
static void TestRect320x240() {
    ScreenProfile p{320, 240, Shape::kRect, 16, {16}, 1, kAssetRgb565Raw, Battery::kNone};
    DialMetrics m(p);
    CHECK(std::fabs(m.k() - 240 / 466.0f) < 1e-6f);
    CHECK_EQ(m.canvas(), 240);
    CHECK(m.safe_radius() == 120.0f);
    CHECK_EQ(m.band_left(), 40);
    CHECK_EQ(m.band_right(), 40);
    CHECK_EQ(m.band_top(), 0);
    CHECK_EQ(m.band_bottom(), 0);
    CHECK(m.center_x() == 160.0f && m.center_y() == 120.0f);
    // Same pixels as the 240 round screen, just shifted into the canvas.
    DialMetrics round240(ScreenProfile{240, 240, Shape::kRound, 16, {16}, 1, kAssetRgb565Raw, Battery::kNone});
    CHECK_EQ(m.px(L::kSpeechBubbleWidth), round240.px(L::kSpeechBubbleWidth));
    CHECK_EQ(m.mid_x(100), 40 + 70);
    // Anchored items stay in the safe circle; a box in a band is outside it.
    Box b = Bubble(m);
    CHECK(b.x >= m.band_left() && b.x + b.w <= 320 - m.band_right());
    CHECK(!m.InSafeArea(0, 100, 30, 30));
    // Portrait: same rule on the other axis.
    DialMetrics tall(ScreenProfile{240, 320, Shape::kRect, 16, {16}, 1, kAssetRgb565Raw, Battery::kNone});
    CHECK_EQ(tall.canvas(), 240);
    CHECK_EQ(tall.band_top(), 40);
    CHECK_EQ(tall.band_bottom(), 40);
    CHECK_EQ(tall.top_mid_y(28), 68);
    CommonChecks(m, "320x240 rect");
    CommonChecks(tall, "240x320 rect");
}

static void TestFontRule() {
    ScreenProfile p{466, 466, Shape::kRound, 14, {14, 20, 30}, 3, kAssetRgb565Raw, Battery::kNone};
    DialMetrics m(p);
    CHECK_EQ(m.font_px(14), 14);
    CHECK_EQ(m.font_px(17), 20);  // the next size up the board has
    CHECK_EQ(m.font_px(40), 30);  // bigger than any: the largest
    CHECK_EQ(m.font_px(8), 14);   // never below font_min_px
}

// fonts_px={12}, font_min_px=16: no board font is readable -> font_min_px, reported.
static void TestFontFloor() {
    ScreenProfile p{240, 240, Shape::kRound, 16, {12}, 1, kAssetRgb565Raw, Battery::kNone};
    CHECK(p.Valid());
    DialMetrics m(p);
    CHECK_EQ(m.font_px(14), 16);
    CHECK_EQ(m.font_px(L::kSpeechBubbleText), 16);
    CHECK(!m.pick_font(14).on_board);
    CHECK_EQ(m.font_px(100), 16);  // even far above: never below font_min_px
    // A readable size exists above the floor: take it.
    DialMetrics m2(ScreenProfile{240, 240, Shape::kRound, 16, {12, 20}, 2, kAssetRgb565Raw, Battery::kNone});
    CHECK_EQ(m2.font_px(14), 20);
    CHECK(m2.pick_font(14).on_board);
    // Target above every font, largest still >= floor: the largest.
    DialMetrics m3(ScreenProfile{466, 466, Shape::kRound, 10, {12}, 1, kAssetRgb565Raw, Battery::kNone});
    CHECK_EQ(m3.font_px(30), 12);
    CHECK(m3.pick_font(30).on_board);
    // No fonts listed: want.
    DialMetrics m4(ScreenProfile{466, 466, Shape::kRound, 16, {}, 0, kAssetRgb565Raw, Battery::kNone});
    CHECK_EQ(m4.font_px(30), 30);
    for (int W = 16; W <= 1024; W++) {
        for (int fmin : {8, 12, 14, 16, 20}) {
            DialMetrics mw(ScreenProfile{W, W, Shape::kRound, fmin, {12}, 1, kAssetRgb565Raw, Battery::kNone});
            for (int d : {1, 14, 17, 40}) CHECK(mw.font_px(d) >= fmin);
        }
    }
}

static void TestValid() {
    const char* why = nullptr;
    ScreenProfile ok{240, 240, Shape::kRound, 16, {16}, 1, kAssetRgb565Raw, Battery::kUnknown};
    CHECK(ok.Valid(&why) && why == nullptr);
    auto bad = [&](ScreenProfile p, const char* field) {
        const char* w = nullptr;
        CHECK(!p.Valid(&w));
        CHECK(w != nullptr && std::strcmp(w, field) == 0);
    };
    ScreenProfile p = ok; p.w = 0; bad(p, "w/h");
    p = ok; p.h = -1; bad(p, "w/h");
    p = ok; p.font_min_px = 0; bad(p, "font_min_px");
    p = ok; p.n_fonts = ScreenProfile::kMaxFonts + 1; bad(p, "n_fonts");
    p = ok; p.n_fonts = -1; bad(p, "n_fonts");
    p = ok; p.fonts_px[0] = 0; bad(p, "fonts_px");
    p = ok; p.fonts_px[1] = 16; p.n_fonts = 2; bad(p, "fonts_px");  // not strictly ascending
    p = ok; p.asset_formats = 0x80; bad(p, "asset_formats");
}

// rh_dial_display.cc BuildRing keeps each rim pixel's depth in 1/16 px (RingPx::d16) for depths
// below ring_max = max(glow_max, halo_max, ring_w) + 1 (MakeSizes). As uint8_t it wrapped from
// W = 1204 (ring_w = round(6 * 1204/466) = 16, ring_max 17, depth*16 up to 271); it is uint16_t now.
static int RingMax(const DialMetrics& m) {
    return std::max(m.px(L::kRhDialGlowMax), std::max(m.px(L::kRhDialHaloMax), m.px(L::kRhDialRingWidth))) + 1;
}
static void TestRingDepth() {
    auto max_d16 = [](int W) {
        DialMetrics m(ScreenProfile{W, W, Shape::kRound, 16, {16}, 1, kAssetRgb565Raw, Battery::kNone});
        return RingMax(m) * 16 - 1;  // d < ring_max, (int)(d * 16) <= ring_max * 16 - 1
    };
    CHECK(max_d16(1203) <= 255);
    CHECK(max_d16(1204) > 255);   // the old uint8_t overflow
    for (int W = 16; W <= 8192; W++) CHECK(max_d16(W) <= 65535);
}

// 16..1024: where LayoutFits() fails the screen is below layout::kMinShortSide and Supported()
// says so; at and above it everything fits. kMinShortSide is the tight bound (W - 1 fails).
static void TestSmallScreens() {
    int last_fail = 0;
    for (int W = 16; W <= 1024; W++) {
        DialMetrics m(ScreenProfile{W, W, Shape::kRound, 16, {16}, 1, kAssetRgb565Raw, Battery::kUnknown});
        const bool fits = LayoutFits(m);
        if (!fits) last_fail = W;
        if (m.Supported()) {
            if (!fits) std::printf("W=%d supported but does not fit\n", W);
            CHECK(fits);
        }
    }
    std::printf("-- small screens: last W that does not fit = %d, kMinShortSide = %d\n", last_fail,
                L::kMinShortSide);
    CHECK_EQ(L::kMinShortSide, last_fail + 1);
    // Non-square screens go by the short side.
    DialMetrics r(ScreenProfile{L::kMinShortSide + 80, L::kMinShortSide, Shape::kRect, 16, {16}, 1, kAssetRgb565Raw,
                                Battery::kNone});
    CHECK(r.Supported() && LayoutFits(r));
    DialMetrics r2(ScreenProfile{400, L::kMinShortSide - 1, Shape::kRect, 16, {16}, 1, kAssetRgb565Raw,
                                 Battery::kNone});
    CHECK(!r2.Supported());
}

int main() {
    Test466();
    Test240();
    TestOldFormulas();
    Test360();
    TestRect320x240();
    TestFontRule();
    TestFontFloor();
    TestValid();
    TestRingDepth();
    TestSmallScreens();
    std::printf("%d checks passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
