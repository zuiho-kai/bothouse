package main

import (
	"os"
	"strings"
)

// envSessionKey returns the calling turn's session key. The bridge sets CC_SESSION_KEY and, for DSH,
// the alias CC_SESSION: DSH scrubs every variable whose name contains KEY/TOKEN/SECRET/PASSWORD from
// its shell, so inside a DSH role only CC_SESSION survives (agent/dsh dshSessionEnv).
func envSessionKey() string { return sessionKeyFrom(os.Getenv) }

func sessionKeyFrom(getenv func(string) string) string {
	if key := strings.TrimSpace(getenv("CC_SESSION_KEY")); key != "" {
		return key
	}
	return strings.TrimSpace(getenv("CC_SESSION"))
}
