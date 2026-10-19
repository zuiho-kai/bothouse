#include "cn_dial/dial_metrics.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace cn_dial {

const char* ShapeName(Shape s) { return s == Shape::kRound ? "round" : "rect"; }

const char* BatteryName(Battery b) {
    switch (b) {
        case Battery::kUnknown: return "unknown";
        case Battery::kGauge: return "gauge";
        default: return "none";
    }
}

std::string ScreenProfile::ToJson() const {
    char tmp[96];
    std::snprintf(tmp, sizeof tmp, "{\"w\":%d,\"h\":%d,\"shape\":\"%s\",\"font_min_px\":%d,\"fonts_px\":[", w, h,
                  ShapeName(shape), font_min_px);
    std::string out = tmp;
    for (int i = 0; i < n_fonts && i < kMaxFonts; i++) {
        if (i) out += ',';
        out += std::to_string(fonts_px[i]);
    }
    out += "],\"asset_formats\":[";
    static const struct { uint8_t bit; const char* name; } kFormats[] = {
        {kAssetRgb565Raw, "rgb565raw"}, {kAssetJpegBaseline, "jpeg_baseline"}, {kAssetCnas1, "cnas1"}};
    bool first = true;
    for (const auto& f : kFormats) {
        if (!(asset_formats & f.bit)) continue;
        if (!first) out += ',';
        out += '"';
        out += f.name;
        out += '"';
        first = false;
    }
    out += "],\"battery\":\"";
    out += BatteryName(battery);
    out += "\"}";
    return out;
}

bool ScreenProfile::Valid(const char** why) const {
    const char* bad = nullptr;
    if (w <= 0 || h <= 0) bad = "w/h";
    else if (font_min_px <= 0) bad = "font_min_px";
    else if (n_fonts < 0 || n_fonts > kMaxFonts) bad = "n_fonts";
    else if (asset_formats & ~(kAssetRgb565Raw | kAssetJpegBaseline | kAssetCnas1)) bad = "asset_formats";
    else {
        for (int i = 0; i < n_fonts; i++) {
            if (fonts_px[i] <= 0 || (i > 0 && fonts_px[i] <= fonts_px[i - 1])) {
                bad = "fonts_px";
                break;
            }
        }
    }
    if (why) *why = bad;
    return bad == nullptr;
}

DialMetrics::DialMetrics(const ScreenProfile& profile) : profile_(profile) {
    canvas_ = std::min(profile_.w, profile_.h);
    canvas_x_ = (profile_.w - canvas_) / 2;
    canvas_y_ = (profile_.h - canvas_) / 2;
    k_ = (float)canvas_ / kDesignCanvas;
}

int DialMetrics::px(layout::Px v) const {
    int scaled = std::max(1, (int)lroundf(v.design * k_));
    return std::max(v.min_px, scaled);
}

int DialMetrics::px(layout::Frac f) const { return (int)lroundf((float)canvas_ * f.v); }

DialMetrics::FontPick DialMetrics::pick_font(int design_px) const {
    const int want = std::max((int)lroundf(design_px * k_), profile_.font_min_px);
    const int n = std::max(0, std::min(profile_.n_fonts, ScreenProfile::kMaxFonts));
    if (n == 0) return {want, true};
    int largest = profile_.fonts_px[0];
    int best = 0;
    for (int i = 0; i < n; i++) {
        const int f = profile_.fonts_px[i];
        largest = std::max(largest, f);
        if (f >= want && (best == 0 || f < best)) best = f;
    }
    if (best) return {best, true};
    if (largest >= profile_.font_min_px) return {largest, true};
    return {profile_.font_min_px, false};
}

int DialMetrics::text_box_h(layout::Px design_h, layout::Font f, int line_h_px) const {
    return std::max(px(design_h), f.lines * line_h_px);
}

bool DialMetrics::InSafeArea(int x, int y, int w, int h, int r) const {
    r = std::max(0, std::min(r, std::min(w, h) / 2));
    const float R = safe_radius(), cx = center_x(), cy = center_y();
    const float xs[2] = {(float)x + r, (float)(x + w) - r};
    const float ys[2] = {(float)y + r, (float)(y + h) - r};
    for (float px_ : xs) {
        for (float py : ys) {
            if (std::hypot(px_ - cx, py - cy) + r > R + 1e-3f) return false;
        }
    }
    return true;
}

}  // namespace cn_dial
