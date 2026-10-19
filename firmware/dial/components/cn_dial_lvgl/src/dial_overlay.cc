// DialOverlay: see dial_overlay.h. Sources: conest firmware/xiaozhi/DECOR.md and patches 0006 / 0010
// (PR #110) for the look, colours and timings of the name tag, status chip, battery arc, bubble and
// work status; role-household rh/static/dial.html (via its board dial rh_dial_display.cc) for the
// bars, dots, stop square, chip fade and name-dot glow / breathing it adds.
#include "cn_dial/dial_overlay.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cn_dial {
namespace {

// conest patch 0006 Pill() / RhDialLink().
constexpr lv_opa_t kPillBgOpa = LV_OPA_60;   // lv_color_black(), LV_OPA_60
constexpr uint32_t kDotLive = 0x3DDC84;      // link up
constexpr uint32_t kDotDown = 0xF5A524;      // link down (also the default before SetLink)
// role-household dial.html: speaking bars, stop square.
constexpr uint32_t kBarGreen = 0x3ecf8e;
constexpr uint32_t kStopRed = 0xf05454;
// conest DECOR.md 1 / patch 0010.
constexpr int kBatteryRefreshMs = 30000;
constexpr int kLowBatteryPercent = 20;
constexpr uint32_t kLowColor = 0xF5A524;
constexpr lv_opa_t kWorkOpa = 140;           // DECOR.md 3: 白色 55%

// role-household dial.html timings (ms) and smoothing (one-pole follow, ~1/3 of the CSS transition):
// @keyframes breathe 4.6 s (idle name dot), dots 1.1 s, .pill.status .25 s, bars implementer's pick.
constexpr float kBreatheIdleMs = 4600;
constexpr float kDotMs = 1100;
constexpr float kTauPill = 85, kTauBar = 60;

float Clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
float Smooth(float u) { u = Clamp01(u); return u * u * (3 - 2 * u); }
float Cyc(double t, float period) { return (float)fmod(t, period); }
float Ang(double t, float div) { return (float)fmod(t / div, 2 * M_PI); }
float Wave(double t, float period) { return (1 - cosf(2 * (float)M_PI * Cyc(t, period) / period)) / 2; }
float Follow(float cur, float target, float dt, float tau) { return cur + (target - cur) * (1 - expf(-dt / tau)); }

// Set a local style property only when it changes (setting one always invalidates the object).
void Num(lv_obj_t* o, lv_style_prop_t p, int32_t v) {
    lv_style_value_t cur;
    if (lv_obj_get_local_style_prop(o, p, &cur, 0) == LV_STYLE_RES_FOUND && cur.num == v) return;
    lv_style_value_t nv;
    nv.num = v;
    lv_obj_set_local_style_prop(o, p, nv, 0);
}
void Col(lv_obj_t* o, lv_style_prop_t p, lv_color_t v) {
    lv_style_value_t cur;
    if (lv_obj_get_local_style_prop(o, p, &cur, 0) == LV_STYLE_RES_FOUND && lv_color_eq(cur.color, v)) return;
    lv_style_value_t nv;
    nv.color = v;
    lv_obj_set_local_style_prop(o, p, nv, 0);
}

void Plain(lv_obj_t* o) {
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
}

void Show(lv_obj_t* o, bool on) {
    if (on) lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
}

lv_obj_t* Box(lv_obj_t* parent, int w, int h, uint32_t color, int radius) {
    lv_obj_t* o = lv_obj_create(parent);
    Plain(o);
    lv_obj_set_size(o, w, h);
    lv_obj_set_style_radius(o, radius, 0);
    lv_obj_set_style_bg_color(o, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
    return o;
}

// conest patch 0006 Pill(): content-sized flex row, black 60%, fully rounded.
lv_obj_t* Pill(lv_obj_t* parent, const OverlaySizes& z) {
    lv_obj_t* p = lv_obj_create(parent);
    Plain(p);
    lv_obj_set_size(p, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_color(p, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(p, kPillBgOpa, 0);
    lv_obj_set_style_radius(p, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_pad_hor(p, z.pad_hor, 0);
    lv_obj_set_style_pad_ver(p, z.pad_ver, 0);
    lv_obj_set_style_pad_column(p, z.gap, 0);
    lv_obj_set_style_text_color(p, lv_color_white(), 0);
    lv_obj_set_flex_flow(p, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(p, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    return p;
}

lv_obj_t* Arc(lv_obj_t* parent, const DialMetrics& m, int d, int w, lv_color_t color, lv_opa_t opa) {
    lv_obj_t* a = lv_arc_create(parent);
    lv_obj_remove_style_all(a);
    lv_obj_remove_flag(a, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(a, d, d);
    lv_obj_set_pos(a, (int)lroundf(m.center_x() - d / 2.0f), (int)lroundf(m.center_y() - d / 2.0f));
    lv_arc_set_bg_angles(a, (lv_value_precise_t)layout::kBatteryArcStart,
                         (lv_value_precise_t)(layout::kBatteryArcStart + layout::kBatteryArcSweep));
    lv_arc_set_value(a, 0);
    lv_obj_set_style_arc_width(a, w, LV_PART_MAIN);
    lv_obj_set_style_arc_opa(a, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_arc_width(a, w, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(a, true, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(a, color, LV_PART_INDICATOR);
    lv_obj_set_style_arc_opa(a, opa, LV_PART_INDICATOR);
    return a;
}

}  // namespace

DialOverlay::DialOverlay(const DialMetrics& metrics) : m_(metrics), z_(MakeOverlaySizes(metrics)) {}

DialOverlay::~DialOverlay() {
    if (battery_timer_) lv_timer_delete(battery_timer_);
    if (battery_arc_) lv_anim_delete(battery_arc_, ArcOpaAnim);
    if (speech_bubble_) lv_anim_delete(speech_bubble_, BubbleOpaAnim);
}

void DialOverlay::Create(lv_obj_t* parent, BatteryReader read_battery) {
    // Name tag: dot + name (+ work status). The live glow is a soft disc just under the pill
    // instead of an LVGL shadow, which is blurred again on every redraw.
    name_glow_ = Box(parent, z_.name_dot + z_.name_glow_extra, z_.name_dot + z_.name_glow_extra, kDotLive,
                     LV_RADIUS_CIRCLE);
    lv_obj_set_style_bg_opa(name_glow_, 70, 0);
    Show(name_glow_, false);
    name_pill_ = Pill(parent, z_);
    name_dot_ = Box(name_pill_, z_.name_dot, z_.name_dot, kDotDown, LV_RADIUS_CIRCLE);
    name_label_ = lv_label_create(name_pill_);
    lv_label_set_text(name_label_, "");
    work_label_ = lv_label_create(name_pill_);
    lv_label_set_text(work_label_, "");
    lv_obj_set_style_text_opa(work_label_, kWorkOpa, 0);
    Show(work_label_, false);  // DECOR.md 3: hidden until the first busy value, no guessing

    // Status chip: bars | dots | stop + text, faded in and out in Tick().
    status_pill_ = Pill(parent, z_);
    lv_obj_align(status_pill_, LV_ALIGN_BOTTOM_MID, 0, -(m_.band_bottom() + z_.chip_bottom));
    bars_ = lv_obj_create(status_pill_);
    Plain(bars_);
    lv_obj_set_size(bars_, z_.bars_w(), z_.bar_h);
    lv_obj_add_event_cb(bars_, BarsDrawCb, LV_EVENT_DRAW_MAIN, this);
    dots_ = lv_obj_create(status_pill_);
    Plain(dots_);
    lv_obj_set_size(dots_, z_.dots_w(), z_.dots_h());
    lv_obj_add_event_cb(dots_, DotsDrawCb, LV_EVENT_DRAW_MAIN, this);
    stop_ = Box(status_pill_, z_.stop, z_.stop, kStopRed, z_.stop_r);
    status_label_ = lv_label_create(status_pill_);
    lv_label_set_text(status_label_, "");
    Show(bars_, false);
    Show(dots_, false);
    Show(stop_, false);
    lv_obj_set_style_opa(status_pill_, LV_OPA_TRANSP, 0);

    // Battery arc: only where the board can read a battery gauge (ScreenProfile::battery).
    read_battery_ = std::move(read_battery);
    if (m_.profile().battery == Battery::kGauge && read_battery_) {
        // DECOR.md 1: 8 px backing, 43% black; 5 px arc, 53% white.
        battery_halo_ = Arc(parent, m_, z_.arc_d, z_.arc_backing_w, lv_color_black(), 110);
        battery_arc_ = Arc(parent, m_, z_.arc_d, z_.arc_w, lv_color_white(), 135);
        battery_timer_ = lv_timer_create(BatteryTimerCb, kBatteryRefreshMs, this);
    }

    // Speech bubble (DECOR.md 2): black 61%, 1 px white 12% border, text white 93%, centred.
    speech_bubble_ = lv_obj_create(parent);
    Plain(speech_bubble_);
    lv_obj_set_style_bg_color(speech_bubble_, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(speech_bubble_, 155, 0);
    lv_obj_set_style_border_width(speech_bubble_, 1, 0);
    lv_obj_set_style_border_color(speech_bubble_, lv_color_white(), 0);
    lv_obj_set_style_border_opa(speech_bubble_, 30, 0);
    lv_obj_set_style_opa(speech_bubble_, LV_OPA_TRANSP, 0);
    Show(speech_bubble_, false);
    speech_label_ = lv_label_create(speech_bubble_);
    lv_label_set_long_mode(speech_label_, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_set_style_text_align(speech_label_, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(speech_label_, lv_color_white(), 0);
    lv_obj_set_style_text_opa(speech_label_, 238, 0);
    lv_label_set_text(speech_label_, "");
    LayoutBubble();

    FitNameTag();
    UpdateBattery();
}

// The bubble's text box holds two lines of the label's font (never below the design 272x40 box):
// on a 240 screen the smallest CJK font is 16 px where 14 x 240/466 would be 7 px.
void DialOverlay::LayoutBubble() {
    const lv_font_t* font = lv_obj_get_style_text_font(speech_label_, LV_PART_MAIN);
    const BubbleBox b = Bubble(m_, z_, font ? (int)lv_font_get_line_height(font) : 0);
    lv_obj_set_size(speech_bubble_, b.w, b.h);
    lv_obj_set_pos(speech_bubble_, b.x, b.y);
    lv_obj_set_style_radius(speech_bubble_, b.r, 0);
    lv_obj_set_size(speech_label_, b.text_w, b.text_h);
    lv_obj_center(speech_label_);
}

void DialOverlay::SetFont(const lv_font_t* font) {
    for (lv_obj_t* l : {name_label_, work_label_, status_label_, speech_label_}) {
        if (l) lv_obj_set_style_text_font(l, font, 0);
    }
    if (speech_label_) LayoutBubble();
    FitNameTag();
}

void DialOverlay::FitNameTag() {
    if (!name_pill_) return;
    lv_obj_update_layout(name_pill_);
    const int y = NameTagY(m_, z_, lv_obj_get_width(name_pill_), lv_obj_get_height(name_pill_));
    lv_obj_align(name_pill_, LV_ALIGN_TOP_MID, 0, y);
}

void DialOverlay::SetName(const char* name) {
    if (!name_label_) return;
    lv_label_set_text(name_label_, name ? name : "");
    FitNameTag();
}

void DialOverlay::SetLink(bool connected) { live_ = connected; }

void DialOverlay::SetBusy(bool busy) {
    if (!work_label_) return;
    lv_label_set_text(work_label_, busy ? "· 工作中" : "· 空闲中");
    Show(work_label_, true);
    FitNameTag();
}

void DialOverlay::SetChip(Chip chip) {
    chip_ = chip;
    // Keep the old contents while the chip fades out to kNone.
    if (chip != Chip::kNone && status_label_) {
        // conest patch 0006 Update(); 「被打断」 is role-household's.
        static const char* text[] = {"", "我在听", "想一想", "在说", "被打断"};
        lv_label_set_text(status_label_, text[(int)chip]);
        Show(bars_, chip == Chip::kSpeaking);
        Show(dots_, chip == Chip::kThinking);
        Show(stop_, chip == Chip::kInterrupted);
    }
    // DECOR.md 2: the bubble belongs to speaking; leaving it fades the bubble out. Text that came
    // before "speaking" is shown now.
    if (chip == Chip::kSpeaking) {
        if (!speech_pending_.empty()) ShowSpeech(speech_pending_.c_str());
    } else {
        HideSpeech();
    }
    speech_pending_.clear();
}

void DialOverlay::SetSpeech(const char* text) {
    if (text == nullptr || text[0] == '\0') {
        speech_pending_.clear();
        HideSpeech();
    } else if (chip_ == Chip::kSpeaking) {
        ShowSpeech(text);
    } else {
        speech_pending_ = text;
    }
}

void DialOverlay::ShowSpeech(const char* text) {
    if (!speech_bubble_) return;
    const bool already_visible = speech_visible();
    lv_anim_delete(speech_bubble_, BubbleOpaAnim);
    speech_hiding_ = false;
    speech_visible_ = true;
    lv_label_set_text(speech_label_, text);
    Show(speech_bubble_, true);
    if (already_visible) {
        lv_obj_set_style_opa(speech_bubble_, LV_OPA_COVER, 0);
        return;
    }
    lv_obj_set_style_opa(speech_bubble_, LV_OPA_TRANSP, 0);
    lv_anim_t anim;
    lv_anim_init(&anim);
    lv_anim_set_var(&anim, speech_bubble_);
    lv_anim_set_exec_cb(&anim, BubbleOpaAnim);
    lv_anim_set_values(&anim, LV_OPA_TRANSP, LV_OPA_COVER);
    lv_anim_set_duration(&anim, 180);  // DECOR.md 2: 淡入 180ms
    lv_anim_set_path_cb(&anim, lv_anim_path_ease_out);
    lv_anim_start(&anim);
}

void DialOverlay::HideSpeech() {
    if (!speech_bubble_ || !speech_visible_ || speech_hiding_) return;
    speech_hiding_ = true;
    lv_anim_delete(speech_bubble_, BubbleOpaAnim);
    const lv_opa_t from = lv_obj_get_style_opa(speech_bubble_, LV_PART_MAIN);
    if (from == LV_OPA_TRANSP) {
        Show(speech_bubble_, false);
        speech_visible_ = speech_hiding_ = false;
        return;
    }
    lv_anim_t anim;
    lv_anim_init(&anim);
    lv_anim_set_var(&anim, speech_bubble_);
    lv_anim_set_exec_cb(&anim, BubbleOpaAnim);
    lv_anim_set_values(&anim, from, LV_OPA_TRANSP);
    lv_anim_set_duration(&anim, 200);  // DECOR.md 2: 淡出 200ms
    lv_anim_set_path_cb(&anim, lv_anim_path_ease_in);
    lv_anim_set_completed_cb(&anim, BubbleFadeDone);
    lv_anim_set_user_data(&anim, this);
    lv_anim_start(&anim);
}

void DialOverlay::BubbleOpaAnim(void* var, int32_t value) {
    lv_obj_set_style_opa((lv_obj_t*)var, (lv_opa_t)value, 0);
}

void DialOverlay::BubbleFadeDone(lv_anim_t* anim) {
    auto* self = static_cast<DialOverlay*>(lv_anim_get_user_data(anim));
    Show(self->speech_bubble_, false);
    self->speech_visible_ = self->speech_hiding_ = false;
}

void DialOverlay::ArcOpaAnim(void* var, int32_t value) {
    lv_obj_set_style_arc_opa((lv_obj_t*)var, (lv_opa_t)value, LV_PART_INDICATOR);
}

void DialOverlay::BatteryTimerCb(lv_timer_t* timer) {
    static_cast<DialOverlay*>(lv_timer_get_user_data(timer))->UpdateBattery();
}

void DialOverlay::UpdateBattery() {
    if (!battery_arc_ || !battery_halo_) return;
    int level = 0;
    bool charging = false;
    if (!read_battery_ || !read_battery_(level, charging)) {
        Show(battery_arc_, false);
        Show(battery_halo_, false);
        return;
    }
    level = std::clamp(level, 0, 100);
    const bool low = level < kLowBatteryPercent;
    Show(battery_arc_, true);
    Show(battery_halo_, true);
    lv_obj_set_style_arc_color(battery_arc_, low ? lv_color_hex(kLowColor) : lv_color_white(), LV_PART_INDICATOR);
    lv_arc_set_value(battery_halo_, level);
    lv_arc_set_value(battery_arc_, level);
    // DECOR.md 1: 正常 53% (135)，低电 86% (220)；充电呼吸 80↔210，低电 150↔255。
    SetBatteryBreathing(charging, low ? 220 : 135, low ? 150 : 80, low ? 255 : 210);
}

void DialOverlay::SetBatteryBreathing(bool on, lv_opa_t steady, int low_opa, int high_opa) {
    lv_anim_delete(battery_arc_, ArcOpaAnim);
    if (!on) {
        lv_obj_set_style_arc_opa(battery_arc_, steady, LV_PART_INDICATOR);
        return;
    }
    lv_anim_t anim;
    lv_anim_init(&anim);
    lv_anim_set_var(&anim, battery_arc_);
    lv_anim_set_exec_cb(&anim, ArcOpaAnim);
    lv_anim_set_values(&anim, low_opa, high_opa);
    lv_anim_set_duration(&anim, 2200);  // DECOR.md 1: 单程 2.2s
    lv_anim_set_reverse_duration(&anim, 2200);
    lv_anim_set_repeat_count(&anim, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_path_cb(&anim, lv_anim_path_ease_in_out);
    lv_anim_start(&anim);
}

void DialOverlay::BarsDrawCb(lv_event_t* e) {
    auto self = static_cast<DialOverlay*>(lv_event_get_user_data(e));
    lv_layer_t* layer = lv_event_get_layer(e);
    lv_area_t c;
    lv_obj_get_coords(self->bars_, &c);
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = lv_color_hex(kBarGreen);
    const OverlaySizes& z = self->z_;
    d.radius = z.bar_r;
    for (int i = 0; i < OverlaySizes::kBars; i++) {
        int h = std::max(2, (int)lroundf(z.bar_h * self->bar_h_[i]));
        lv_area_t a;
        a.x1 = c.x1 + i * (z.bar_w + z.bar_gap);
        a.x2 = a.x1 + z.bar_w - 1;
        a.y1 = c.y1 + (z.bar_h - h) / 2;
        a.y2 = a.y1 + h - 1;
        lv_draw_rect(layer, &d, &a);
    }
}

void DialOverlay::DotsDrawCb(lv_event_t* e) {
    auto self = static_cast<DialOverlay*>(lv_event_get_user_data(e));
    lv_layer_t* layer = lv_event_get_layer(e);
    lv_area_t c;
    lv_obj_get_coords(self->dots_, &c);
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = lv_color_white();
    d.radius = LV_RADIUS_CIRCLE;
    const OverlaySizes& z = self->z_;
    for (int i = 0; i < OverlaySizes::kDots; i++) {
        float p = self->dot_p_[i];
        d.bg_opa = (lv_opa_t)(255 * (.5f + .5f * p));
        lv_area_t a;
        a.x1 = c.x1 + i * (z.dot + z.dot_gap);
        a.x2 = a.x1 + z.dot - 1;
        a.y1 = c.y1 + z.dot_jump - (int)lroundf(z.dot_jump * p);
        a.y2 = a.y1 + z.dot - 1;
        lv_draw_rect(layer, &d, &a);
    }
}

void DialOverlay::Tick(double t, float dt, float level) {
    if (!status_pill_) return;

    // Status chip fade (.25 s like the web); DECOR.md 2: it yields to the speech bubble.
    const bool chip_on = chip_ != Chip::kNone && !speech_visible();
    chip_opa_ = Follow(chip_opa_, chip_on ? 1 : 0, dt, kTauPill);
    Num(status_pill_, LV_STYLE_OPA, chip_opa_ > .98f ? 255 : (int32_t)lroundf(chip_opa_ * 16) * 255 / 16);

    // Speaking bars follow the loudness.
    if (chip_ == Chip::kSpeaking) {
        bool changed = false;
        for (int i = 0; i < OverlaySizes::kBars; i++) {
            float target = std::max(.2f, std::min(1.0f, level * (.6f + .5f * fabsf(sinf(Ang(t, 90) + i * 1.7f)))));
            float nh = Follow(bar_h_[i], target, dt, kTauBar);
            changed |= lroundf(nh * z_.bar_h) != lroundf(bar_h_[i] * z_.bar_h);
            bar_h_[i] = nh;
        }
        if (changed) lv_obj_invalidate(bars_);
    }

    // Thinking dots: 1.1 s bounce, .15 s apart (0,80,100%: y 0 opa .5; 40%: y -jump opa 1), eased.
    if (chip_ == Chip::kThinking) {
        bool changed = false;
        for (int i = 0; i < OverlaySizes::kDots; i++) {
            float u = Cyc(t - i * 150 + kDotMs * 10, kDotMs) / kDotMs;
            float p = u < .4f ? Smooth(u / .4f) : (u < .8f ? Smooth((.8f - u) / .4f) : 0);
            changed |= lroundf(p * z_.dot_jump * 2) != lroundf(dot_p_[i] * z_.dot_jump * 2);
            dot_p_[i] = p;
        }
        if (changed) lv_obj_invalidate(dots_);
    }

    // Link dot: conest colours; role-household adds a glow when live and a breath when idle.
    Col(name_dot_, LV_STYLE_BG_COLOR, lv_color_hex(live_ ? kDotLive : kDotDown));
    if (live_) {  // follow the dot (the pill re-centres when the name changes)
        lv_area_t a;
        lv_obj_get_coords(name_dot_, &a);
        Num(name_glow_, LV_STYLE_X, a.x1 - z_.name_glow_extra / 2);
        Num(name_glow_, LV_STYLE_Y, a.y1 - z_.name_glow_extra / 2);
    }
    if (live_ != !lv_obj_has_flag(name_glow_, LV_OBJ_FLAG_HIDDEN)) {
        lv_obj_move_to_index(name_glow_, lv_obj_get_index(name_pill_));  // just under the pill
        Show(name_glow_, live_);
    }
    float pulse = chip_ == Chip::kNone ? 1 - .55f * Wave(t, kBreatheIdleMs) : 1;
    Num(name_dot_, LV_STYLE_BG_OPA, (int32_t)lroundf(pulse * 32) * 255 / 32);
}

}  // namespace cn_dial
