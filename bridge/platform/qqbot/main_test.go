package qqbot

import (
	"os"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Sandboxed(func() int { return testutil.RunLocalHTTPTests(m) }))
}
