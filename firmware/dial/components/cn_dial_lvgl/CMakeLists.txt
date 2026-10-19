# cn_dial_lvgl: the dial overlay drawn with LVGL (DialOverlay: name tag, status chip, battery arc,
# speech bubble, work status). ESP-IDF component only; depends on LVGL (lvgl/lvgl, see
# idf_component.yml) and cn_dial, nothing board-specific. The host tests cover its pure
# layout maths through cn_dial (overlay_layout.h).
if(NOT ESP_PLATFORM)
    message(FATAL_ERROR "cn_dial_lvgl is an ESP-IDF component; host builds use cn_dial only")
endif()
idf_component_register(SRCS "src/dial_overlay.cc" INCLUDE_DIRS "include" REQUIRES cn_dial lvgl)
