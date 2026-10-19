#pragma once
// Value types of the dial layout (layout/dial-layout.v1.json). Units are 1/466 of the canvas.

namespace cn_dial::layout {

// A length: design value in canvas units, scaled to the screen, never below min_px.
// design == 0 means a fixed pixel count (min_px) that does not scale.
struct Px {
    float design;
    int min_px;
};

// A length given as a fraction of the canvas side.
struct Frac {
    float v;
};

// A font size: design px on the 466 canvas and how many lines the text box holds.
struct Font {
    int design_px;
    int lines;
};

}  // namespace cn_dial::layout
