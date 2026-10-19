// Host tests of cn_dial (CI job dial-metrics). No framework: each CHECK prints on failure and the
// process exits non-zero if any failed.
#include "cn_dial/dial_layout_v1.h"
#include "cn_dial/dial_metrics.h"

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

// The speech bubble as conest_decor.cc (role-household fw branch rh-conest-decor) builds it:
// text box = max(design 40, lines * line height), bubble = max(design 58, text box + 18).
struct Box { int x, y, w, h, r; };
static Box Bubble(const DialMetrics& m) {
    const int f = m.font_px(L::kSpeechBubbleText);
    const int text_h = m.text_box_h(L::kSpeechBubbleTextHeight, L::kSpeechBubbleText, LineH(f));
    const int w = m.px(L::kSpeechBubbleWidth);
    const int h = std::max(m.px(L::kSpeechBubbleHeight), text_h + m.px(L::kSpeechBubbleTextPad));
    return {m.mid_x(w), m.bottom_mid_y(m.px(L::kSpeechBubbleBottom), h), w, h, m.px(L::kSpeechBubbleRadius)};
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
    CHECK_EQ(m.px(L::kRhDialNameTagTop), 17);      // :236 lroundf(240 * 0.07f)
    CHECK_EQ(m.px(L::kRhDialStatusChipBottom), 31); // :249 lroundf(240 * 0.13f)
    CHECK_EQ(m.px(L::kRhDialPillPadVer), 4);       // :62
    CHECK_EQ(m.px(L::kRhDialPillPadHor), 12);
    CHECK_EQ(m.px(L::kRhDialPillGap), 6);
    CHECK_EQ(m.px(L::kRhDialPillBorder), 1);       // :126
    CHECK_EQ(m.px(L::kRhDialNameDot), 7);          // :63
    CHECK_EQ(m.px(L::kRhDialNameGlowExtra), 6);    // :240
    CHECK_EQ(m.px(L::kRhDialBarWidth), 3);         // :64
    CHECK_EQ(m.px(L::kRhDialBarHeight), 15);
    CHECK_EQ(m.px(L::kRhDialBarGap), 3);
    CHECK_EQ(m.px(L::kRhDialBarRadius), 2);        // :466
    CHECK_EQ(m.px(L::kRhDialDotSize), 5);          // :65
    CHECK_EQ(m.px(L::kRhDialDotGap), 4);
    CHECK_EQ(m.px(L::kRhDialDotJump), 5);
    CHECK_EQ(m.px(L::kRhDialStopSize), 9);         // :66
    CHECK_EQ(m.px(L::kRhDialStopRadius), 2);       // :258
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
        CHECK_EQ(m.px(L::kRhDialNameTagTop), (int)lroundf(W * 0.07f));                  // :236
        CHECK_EQ(m.px(L::kRhDialStatusChipBottom), (int)lroundf(W * 0.13f));            // :249
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

int main() {
    Test466();
    Test240();
    TestOldFormulas();
    Test360();
    TestRect320x240();
    TestFontRule();
    std::printf("%d checks passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
