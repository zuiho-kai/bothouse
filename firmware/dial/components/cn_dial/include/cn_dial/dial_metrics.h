#pragma once
// Canvas units -> pixels for one screen. The dial is designed on conest's 466 x 466 round canvas
// (DECOR.md: 尺寸都按 466×466 圆屏算); every screen gets the same layout scaled by
// k = short side / 466:
//   - the canvas is a square as big as the short side, centred on the screen;
//   - the safe area is the circle inscribed in the canvas (round / arc components stay in it);
//   - on a non-square screen the leftover strips along the long side are "bands";
//   - fonts do not scale linearly: see font_px().
#include "cn_dial/dial_layout_v1.h"
#include "cn_dial/layout_types.h"
#include "cn_dial/screen_profile.h"

namespace cn_dial {

class DialMetrics {
public:
    static constexpr float kDesignCanvas = 466.0f;

    explicit DialMetrics(const ScreenProfile& profile);

    const ScreenProfile& profile() const { return profile_; }
    float k() const { return k_; }

    int canvas() const { return canvas_; }        // canvas side in px (= short side)
    int canvas_x() const { return canvas_x_; }    // canvas top-left on the screen
    int canvas_y() const { return canvas_y_; }
    float center_x() const { return canvas_x_ + canvas_ / 2.0f; }
    float center_y() const { return canvas_y_ + canvas_ / 2.0f; }
    float safe_radius() const { return canvas_ / 2.0f; }
    int band_left() const { return canvas_x_; }
    int band_right() const { return profile_.w - canvas_x_ - canvas_; }
    int band_top() const { return canvas_y_; }
    int band_bottom() const { return profile_.h - canvas_y_ - canvas_; }

    // max(min_px, max(1, round(design * k))); design 0 = fixed min_px.
    int px(layout::Px v) const;
    int px(float design, int min_px = 1) const { return px(layout::Px{design, min_px}); }
    // round(canvas * frac)
    int px(layout::Frac f) const;

    // Whether the dial fits this screen depends on the board's font too: cn_dial::Supported()
    // (overlay_layout.h).

    // A font size for this screen. Never below font_min_px:
    //   want = max(round(design_px * k), font_min_px);
    //   the smallest board font >= want; else the largest board font if it is >= font_min_px;
    //   else font_min_px with on_board = false (the board has no readable font: the caller
    //   should log it). No board fonts listed: want.
    struct FontPick {
        int px;
        bool on_board;
    };
    FontPick pick_font(int design_px) const;
    int font_px(int design_px) const { return pick_font(design_px).px; }
    int font_px(layout::Font f) const { return font_px(f.design_px); }

    // Height of a text box designed `design_h` high that must hold f.lines lines of a font whose
    // line height (from the font itself, e.g. lv_font_get_line_height) is line_h_px.
    int text_box_h(layout::Px design_h, layout::Font f, int line_h_px) const;

    // Screen y of the top edge of a top_mid item `dy` px below the canvas top, and of a
    // bottom_mid item `h` px high whose bottom is `dy` px above the canvas bottom; x of an item
    // `w` px wide centred on the canvas. Anchors follow the canvas, not the long side.
    int top_mid_y(int dy) const { return canvas_y_ + dy; }
    int bottom_mid_y(int dy, int h) const { return canvas_y_ + canvas_ - dy - h; }
    int mid_x(int w) const { return canvas_x_ + (canvas_ - w) / 2; }

    // True when the rectangle [x, x+w) x [y, y+h) with corner radius r lies in the safe circle.
    bool InSafeArea(int x, int y, int w, int h, int r = 0) const;

private:
    ScreenProfile profile_;
    float k_;
    int canvas_, canvas_x_, canvas_y_;
};

}  // namespace cn_dial
