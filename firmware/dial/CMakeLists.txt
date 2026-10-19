# Host build of cn_dial and its unit tests (CI job dial-metrics):
#   cmake -S firmware/dial -B build/dial && cmake --build build/dial && ctest --test-dir build/dial --output-on-failure
cmake_minimum_required(VERSION 3.16)
project(cn_dial_host CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror)
add_subdirectory(components/cn_dial)
enable_testing()
add_executable(test_dial_metrics tests/test_dial_metrics.cc)
target_link_libraries(test_dial_metrics PRIVATE cn_dial)
add_test(NAME dial_metrics COMMAND test_dial_metrics)
