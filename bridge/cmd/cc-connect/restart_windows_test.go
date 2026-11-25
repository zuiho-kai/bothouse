//go:build windows

package main

import "testing"

func TestRestartChildAttrHidesWindowWithoutConsole(t *testing.T) {
	if a := restartChildAttr(true); a != nil {
		t.Fatalf("with a console the child shares it, got %+v", a)
	}
	a := restartChildAttr(false)
	if a == nil || a.CreationFlags&createNoWindow == 0 || !a.HideWindow {
		t.Fatalf("without a console the child must get CREATE_NO_WINDOW, got %+v", a)
	}
}
