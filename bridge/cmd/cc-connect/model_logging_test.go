package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestModelCommandIgnoresDaemonLog(t *testing.T) {
	if os.Getenv("CONEST_MODEL_LOG_HELPER") == "1" {
		os.Args = []string{"bothouse", "model", "--help"}
		main()
		os.Exit(0)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestModelCommandIgnoresDaemonLog$")
	// A directory cannot be opened as a log, even when tests run as admin.
	cmd.Env = append(os.Environ(), "CONEST_MODEL_LOG_HELPER=1", "CC_LOG_FILE="+t.TempDir())
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "Usage: bothouse model") {
		t.Fatalf("model query depends on daemon log: %v\n%s", err, out)
	}
}
