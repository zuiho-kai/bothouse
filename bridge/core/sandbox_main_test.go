package core

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// 本包测试跑在临时 HOME 里，见 tests/testutil/sandbox.go 与 docs/code-standards.md。
// 向导的飞书机器人 open_id 查询不连网：默认查不到，要用的测试自己换。
func TestMain(m *testing.M) {
	wizardFeishuBotOpenID = func(context.Context, string, string, string) (string, error) {
		return "", errors.New("no network in core tests")
	}
	os.Exit(testutil.RunSandboxed(m))
}
