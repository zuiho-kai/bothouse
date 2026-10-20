package core

import (
	"os"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// 本包测试跑在临时 HOME 里，见 tests/testutil/sandbox.go 与 docs/code-standards.md。
func TestMain(m *testing.M) { os.Exit(testutil.RunSandboxed(m)) }
