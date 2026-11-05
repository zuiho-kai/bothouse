//go:build windows

package main

import "os"

// The gate, the task board, the lead scripts and the hooks are Python, and every child process
// inherits this environment. On a Chinese Windows, Python's open() / read_text() default to the
// locale code page (cp936): the board's UTF-8 jsonl fails to read, and a title with a character
// GBK lacks (⏰) fails to write (reproduced on sanxin-hk with PYTHONUTF8=0). UTF-8 mode makes them
// read and write what the Go and Node sides do. An explicit user setting is kept.
func init() {
	if _, set := os.LookupEnv("PYTHONUTF8"); !set {
		_ = os.Setenv("PYTHONUTF8", "1")
	}
}
