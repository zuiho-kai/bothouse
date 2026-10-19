#pragma once
// DialOverlay: everything drawn over the character on the round dial, as one LVGL component that
// any board's display can own (conest's 1.75 CNAS screen, role-household's 240 dial, a future
// screen of any size). Look and numbers are conest's; sizes come only from cn_dial (DialMetrics /
// OverlaySizes, layout/dial-layout.v1.json), never from constants here.
//   - Name tag (conest patch 0006): pill on top with a link dot and the name; the work status
//     「· 工作中 / · 空闲中」 inside it (DECOR.md 3), hidden until SetBusy() is first called and
//     again after ClearBusy(). A long name is cut with "..." at NameLabelMaxW (overlay_layout.h) so
//     the tag never moves down over the face or out of the round screen.
//   - Status chip (patch 0006): pill at the bottom, 「我在听 / 想一想 / 在说」; role-household adds
//     speaking bars, thinking dots and the 「被打断」 stop square as its contents, a .25 s fade, and
//     the live glow / idle breathing of the name dot.
//   - Battery arc (DECOR.md 1, patch 0010): only on screens whose ScreenProfile says
//     battery == kGauge and only when a battery reader is given.
//   - Speech bubble (DECOR.md 2): the sentence being spoken; the status chip yields to it.
//
// Depends on LVGL (9.x) and cn_dial only. Threading: every method expects the LVGL / display lock
// to be held (the battery timer is an lv_timer, so it runs in the LVGL task with the lock held).
#include <lvgl.h>

#include <cstdint>
#include <functional>
#include <string>

#include "cn_dial/overlay_layout.h"

namespace cn_dial {

class DialOverlay {
public:
    enum class Chip : uint8_t { kNone, kListening, kThinking, kSpeaking, kInterrupted };
    // Battery level 0..100 and charging; false = no reading (the arc hides).
    using BatteryReader = std::function<bool(int& level, bool& charging)>;

    explicit DialOverlay(const DialMetrics& metrics);
    ~DialOverlay();
    DialOverlay(const DialOverlay&) = delete;
    DialOverlay& operator=(const DialOverlay&) = delete;

    // Build on `parent`, a full-screen object at (0, 0) (screen coordinates = parent coordinates).
    // Text uses the font the labels inherit from `parent`; call SetFont() to use another one.
    void Create(lv_obj_t* parent, BatteryReader read_battery = nullptr);
    void SetFont(const lv_font_t* font);

    void SetName(const char* name);
    void SetLink(bool connected);   // link dot: green + glow when connected, orange when not
    void SetBusy(bool busy);        // work status next to the name
    void ClearBusy();               // work status unknown (stale / no link): hide it, no guessing
    void SetChip(Chip chip);        // leaving kSpeaking fades the speech bubble out
    // A sentence being spoken (tts sentence_start). Empty / nullptr: fade the bubble out. Text that
    // arrives before the chip is kSpeaking is kept and shown when it becomes kSpeaking.
    void SetSpeech(const char* text);
    bool speech_visible() const { return speech_visible_ && !speech_hiding_; }
    void UpdateBattery();

    // Per frame (LVGL task): t_ms since boot, dt_ms since the last call, level 0..1 = speaking
    // loudness (moves the bars).
    void Tick(double t_ms, float dt_ms, float level);

    const OverlaySizes& sizes() const { return z_; }
    // The pill font as cn_dial's layout needs it (one CJK glyph's width, line height); {0, 0} for
    // nullptr. Boards pass it to cn_dial::Supported() before building a dial.
    static PillFont MeasureFont(const lv_font_t* font);
    lv_obj_t* name_pill() const { return name_pill_; }

private:
    void FitNameTag();
    void ShowSpeech(const char* text);
    void HideSpeech();
    void SetBatteryLook(bool charging, bool low);
    void LayoutBubble();

    static void ArcOpaAnim(void* var, int32_t value);
    static void BubbleOpaAnim(void* var, int32_t value);
    static void BubbleFadeDone(lv_anim_t* anim);
    static void BatteryTimerCb(lv_timer_t* timer);
    static void BarsDrawCb(lv_event_t* e);
    static void DotsDrawCb(lv_event_t* e);

    const DialMetrics m_;
    const OverlaySizes z_;
    BatteryReader read_battery_;

    lv_obj_t* name_pill_ = nullptr;
    lv_obj_t* name_dot_ = nullptr;
    lv_obj_t* name_glow_ = nullptr;
    lv_obj_t* name_label_ = nullptr;
    lv_obj_t* work_label_ = nullptr;
    lv_obj_t* status_pill_ = nullptr;
    lv_obj_t* bars_ = nullptr;
    lv_obj_t* dots_ = nullptr;
    lv_obj_t* stop_ = nullptr;
    lv_obj_t* status_label_ = nullptr;
    lv_obj_t* battery_halo_ = nullptr;
    lv_obj_t* battery_arc_ = nullptr;
    lv_timer_t* battery_timer_ = nullptr;
    lv_obj_t* speech_bubble_ = nullptr;
    lv_obj_t* speech_label_ = nullptr;

    Chip chip_ = Chip::kNone;
    int battery_look_ = -1;         // charging * 2 + low last applied; -1 = none (arc hidden)
    bool live_ = false;
    bool speech_visible_ = false;
    bool speech_hiding_ = false;
    std::string speech_pending_;
    float chip_opa_ = 0;
    float bar_h_[OverlaySizes::kBars] = {};
    float dot_p_[OverlaySizes::kDots] = {};
};

}  // namespace cn_dial
