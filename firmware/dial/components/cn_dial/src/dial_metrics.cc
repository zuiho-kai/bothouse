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

int DialMetrics::font_px(int design_px) const {
    const int want = std::max((int)lroundf(design_px * k_), profile_.font_min_px);
    const int n = std::min(profile_.n_fonts, ScreenProfile::kMaxFonts);
    if (n == 0) return want;
    int largest = profile_.fonts_px[0];
    int best = 0;
    for (int i = 0; i < n; i++) {
        const int f = profile_.fonts_px[i];
        largest = std::max(largest, f);
        if (f >= want && (best == 0 || f < best)) best = f;
    }
    return best ? best : largest;
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
