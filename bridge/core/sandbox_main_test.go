package core

import (
	"context"
	"errors"
	"net"
	"os"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// 本包测试跑在临时 HOME 里，见 tests/testutil/sandbox.go 与 docs/code-standards.md。
// 向导的飞书机器人 open_id 查询不连网：默认查不到，要用的测试自己换。
func TestMain(m *testing.M) {
	// #699 D: board.py run by a test asks CC_BIN (this test binary) to move a task's state:
	// answer as a bridge that has no record of it, instead of running the whole suite again.
	if len(os.Args) > 2 && os.Args[1] == "workspace" && os.Args[2] == "transition" {
		os.Stdout.WriteString(`{"known":false}` + "\n")
		os.Exit(0)
	}
	wizardFeishuBotOpenID = func(context.Context, string, string, string) (string, error) {
		return "", errors.New("no network in core tests")
	}
	// the gate port: a free one, never the 9930 a real bothouse on this machine may hold
	if l, err := net.Listen("tcp", "127.0.0.1:0"); err == nil {
		gateAddr = l.Addr().String()
		l.Close()
	}
	// #134: every temporary-error re-send (at capacity included) waits a backoff step first; tests
	// would sit out the live 15s, so they use 1ms unless they set their own.
	rateLimitBackoffBase = time.Millisecond
	os.Exit(testutil.RunSandboxed(m))
}
