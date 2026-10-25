package main

import (
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"
)

// Invoked only by an isolated launchd integration run, never by the normal suite.
func TestManagedTrayQuitHelper(t *testing.T) {
	trigger := os.Getenv("BOTHOUSE_TEST_TRAY_QUIT_TRIGGER")
	if trigger == "" {
		t.Skip("isolated launchd helper")
	}
	os.Args = []string{os.Args[0]}
	if startDesktopTray() {
		t.Fatal("isolated HOME started native tray")
	}
	fmt.Println("isolated HOME: native tray skipped")
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); {
		if _, err := os.Stat(trigger); err == nil {
			requestDesktopShutdown()
			<-desktopShutdown
			slog.Info("shutdown requested", "source", "tray")
			stopDesktopService()
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("tray quit trigger timed out")
}
