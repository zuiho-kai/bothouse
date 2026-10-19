#pragma once
// What a board's screen is, filled in by the board file and reported to the host in hello
// ("display" object). Plain C++: no LVGL, no ESP-IDF, so it builds and is tested on a PC.
#include <cstdint>
#include <string>

namespace cn_dial {

enum class Shape : uint8_t { kRound, kRect };

// kUnknown: the board cannot tell battery from USB power (sp-esp32-s3-1.28-box power_manager.h
// IsDischarging() just returns !charging), so nothing battery-related is drawn by default.
enum class Battery : uint8_t { kNone, kUnknown, kGauge };

// Bit set of avatar / animation formats the board can show.
enum AssetFormat : uint8_t {
    kAssetRgb565Raw = 1 << 0,     // raw little-endian RGB565, w*h*2 bytes (host rh/dial.py ?size=)
    kAssetJpegBaseline = 1 << 1,
    kAssetCnas1 = 1 << 2,         // conest CNAS container (firmware/esp32s3/ASSETS_FORMAT.md)
};

struct ScreenProfile {
    static constexpr int kMaxFonts = 8;

    int w = 0, h = 0;                // pixels
    Shape shape = Shape::kRound;
    int font_min_px = 0;             // smallest readable CJK font on this screen
    int fonts_px[kMaxFonts] = {};    // font sizes the board has, ascending
    int n_fonts = 0;
    uint8_t asset_formats = 0;       // AssetFormat bits
    Battery battery = Battery::kNone;

    // False (and *why, if given, says which field) when the profile cannot describe a real
    // screen: w/h not positive, font_min_px not positive, n_fonts outside 0..kMaxFonts, fonts_px
    // not positive and strictly ascending, or unknown asset_formats bits. A board whose fonts are
    // all below font_min_px is still valid; DialMetrics::pick_font() reports it.
    bool Valid(const char** why = nullptr) const;

    // The hello "display" object, e.g.
    // {"w":240,"h":240,"shape":"round","font_min_px":16,"fonts_px":[16],"asset_formats":["rgb565raw"],"battery":"unknown"}
    std::string ToJson() const;
};

const char* ShapeName(Shape s);
const char* BatteryName(Battery b);

}  // namespace cn_dial
