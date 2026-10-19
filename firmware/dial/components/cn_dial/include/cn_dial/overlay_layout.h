#pragma once
// Pixel sizes and positions of the dial overlay on one screen: the name tag and status chip (one
// pill style, conest patch 0006), the battery arc, speech bubble and work status (conest DECOR.md /
// patch 0010). Plain C++ (no LVGL): cn_dial_lvgl's DialOverlay draws with these, and the host
// tests check them. Every number comes from layout/dial-layout.v1.json through DialMetrics.
#include "cn_dial/dial_metrics.h"

namespace cn_dial {

struct OverlaySizes {
    static constexpr int kBars = 5;   // speaking bars (role-household dial.html BAR_N)
    static constexpr int kDots = 3;   // thinking dots

    // Name tag: top edge below the canvas top; dot and the live glow around it.
    int name_top, name_dot, name_glow_extra;
    // Both pills: padding and column gap (the work label sits one gap after the name).
    int pad_hor, pad_ver, gap;
    // Status chip: bottom edge above the canvas bottom; bars, dots and stop square inside it.
    int chip_bottom;
    int bar_w, bar_h, bar_gap, bar_r;
    int dot, dot_gap, dot_jump;
    int stop, stop_r;
    // Battery arc (centred on the canvas) and its dark backing.
    int arc_d, arc_w, arc_backing_w;
    // Speech bubble, before the text box grows for the font (see Bubble()).
    int bubble_w, bubble_min_h, bubble_bottom, bubble_r;
    int text_w, text_min_h, text_pad;

    int bars_w() const { return kBars * bar_w + (kBars - 1) * bar_gap; }
    int dots_w() const { return kDots * dot + (kDots - 1) * dot_gap; }
    int dots_h() const { return dot + dot_jump; }
};

OverlaySizes MakeOverlaySizes(const DialMetrics& m);

// The speech bubble for a label font whose line height is line_h_px: the text box holds
// layout::kSpeechBubbleText.lines lines of it (never below the design box), the bubble keeps the
// design padding around it. x / y: screen position (bottom_mid on the canvas).
struct BubbleBox {
    int x, y, w, h, r;
    int text_w, text_h;
};
BubbleBox Bubble(const DialMetrics& m, const OverlaySizes& z, int line_h_px);

// Screen y of the name pill's top edge for a pill w x h px (fully rounded): conest's name_tag.top,
// moved down when the pill is so wide that a rounded end would cross the inner edge of the
// battery arc's backing, radius (228 - 8) / 466 of the canvas (DECOR.md 1: arc radius 228, backing
// 8 px; DECOR.md 5: 名字变长再加「· 工作中」后不挤到圆边). A pill too wide to fit anywhere stays at the top.
int NameTagY(const DialMetrics& m, const OverlaySizes& z, int w, int h);

// Screen y of the status chip's top edge for a chip h px high.
inline int ChipY(const DialMetrics& m, const OverlaySizes& z, int h) { return m.bottom_mid_y(z.chip_bottom, h); }

// The font the pills and the bubble are drawn with, as the board measures it: glyph_w = advance of
// one CJK glyph (e.g. lv_font_get_glyph_width(font, U'工', 0)), line_h = line height
// (lv_font_get_line_height). Every text on the dial is CJK, so widths go in whole glyphs.
struct PillFont {
    int glyph_w, line_h;
};

// The name tag the layout is checked against: dot + 「等待主机」 (4 glyphs, the longest fixed name,
// shown before the host speaks) + 「· 工作中」 (5 glyph widths). Status chip: 5 bars + 3 glyphs
// (「我在听」「想一想」「被打断」, patch 0006 Update()).
inline constexpr int kRefNameGlyphs = 4, kWorkGlyphs = 5, kChipGlyphs = 3;

// Name pill height (pad + the taller of a text line and the dot) and width for a name and a work
// label of the given pixel widths (work_w 0 = no work label).
inline int NamePillH(const OverlaySizes& z, int line_h) { return 2 * z.pad_ver + (line_h > z.name_dot ? line_h : z.name_dot); }
inline int NamePillW(const OverlaySizes& z, int name_w, int work_w) {
    return 2 * z.pad_hor + z.name_dot + z.gap + name_w + (work_w > 0 ? z.gap + work_w : 0);
}

// The widest the name pill may get: as wide as the arc-avoid circle (see NameTagY) allows at the
// height where the reference name tag sits. A wider pill would have to move further down over the
// face (or cross the arc / leave the round screen), so the name is cut there instead.
int NameTagMaxW(const DialMetrics& m, const OverlaySizes& z, PillFont f);
// The widest the name label may get (the board cuts it with "..."): NameTagMaxW minus the dot,
// the paddings, the gaps and a work label work_w px wide (room for it is always kept, so a name is
// cut the same way whether the work status is shown or not). Never below one glyph.
int NameLabelMaxW(const DialMetrics& m, const OverlaySizes& z, PillFont f, int work_w);

// Everything the overlay draws fits: the reference name tag (with and without the work status), the
// status chip and the speech bubble inside the safe circle, the name tag above the chip and above
// the bubble. f: the board's pill font.
bool OverlayFits(const DialMetrics& m, PillFont f);

// True when the dial can be drawn on this screen with this font: the short side is at least
// layout::kMinShortSide (the tight bound for the 16 px font, tests TestSmallScreens) and the
// overlay fits with the board's own font (a bigger font needs a bigger screen; TestFontSizes).
bool Supported(const DialMetrics& m, PillFont f);

}  // namespace cn_dial
