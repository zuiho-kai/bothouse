# cn_dial: plain C++ (no LVGL / ESP-IDF). Under ESP-IDF it is a component (add
# firmware/dial/components to EXTRA_COMPONENT_DIRS); elsewhere a static library
# (firmware/dial/CMakeLists.txt builds it with the host tests).
if(ESP_PLATFORM)
    idf_component_register(SRCS "src/dial_metrics.cc" INCLUDE_DIRS "include")
else()
    add_library(cn_dial STATIC src/dial_metrics.cc)
    target_include_directories(cn_dial PUBLIC include)
    target_compile_features(cn_dial PUBLIC cxx_std_17)
endif()
