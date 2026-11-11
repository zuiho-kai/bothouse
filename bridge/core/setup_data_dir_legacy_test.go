package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// PR #1594 审查 B：自定义数据目录（BOTHOUSE_DATA_DIR 不是 ~/.bothouse）的老用户，旧版把 DSH 装在
// ~/.bothouse/dsh、频道库放在 ~/.conest-collab。升级后新目录里什么都没有：启动刷新找不到 install.sh
// 静默跳过，子进程开空库，频道和角色看起来全没了。新目录确实没有、旧位置有时沿用旧位置（不搬）。
func TestCustomDataDirUpgradeKeepsTheOldInstallAndChannels(t *testing.T) {
	home, data := t.TempDir(), t.TempDir()
	testutil.SetHome(t, home)
	t.Setenv("CONEST_COLLAB_DATA", "")
	t.Setenv("BOTHOUSE_DATA_DIR", "")

	// 旧版（默认目录）装好：插件和一个已导入角色的频道库。
	oldDSH := filepath.Join(home, ".bothouse", "dsh")
	oldCollab := filepath.Join(home, ".conest-collab")
	if _, err := ExtractEmbeddedDSH(oldDSH); err != nil {
		t.Fatal(err)
	}
	if err := writeDSHStamp(filepath.Join(oldDSH, dshVersionFile), dshStamp{Version: "v0.0.1"}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(oldCollab, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldCollab, "wizard-members.imported.json"), []byte(`{"members":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldCollab, "channels.db"), []byte("old channels"), 0o600); err != nil {
		t.Fatal(err)
	}

	// 升级后的桥带着自定义数据目录起来。
	t.Setenv("BOTHOUSE_DATA_DIR", data)
	if got, _ := embeddedDSHDir(); got != oldDSH {
		t.Fatalf("plugin dir = %q; want the old install %q", got, oldDSH)
	}
	if refreshed, err := RefreshEmbeddedDSH("", "v0.0.2"); err != nil || !refreshed {
		t.Fatalf("startup refresh = %v, %v; want the old install refreshed", refreshed, err)
	}
	if got := collabDataDir(); got != oldCollab {
		t.Fatalf("channel data = %q; want the old channels %q", got, oldCollab)
	}
	if !DSHRouteConfigured() {
		t.Fatal("DSH route not configured: the gate would not start for the imported members")
	}
	if env := strings.Join(dshDesktopEnv(data), "\n"); !strings.Contains(env, "CONEST_COLLAB_DATA="+oldCollab+"\n") {
		t.Fatalf("child environment does not point at the old channels: %s", env)
	}
	if _, err := os.Stat(filepath.Join(data, "conest-collab")); !os.IsNotExist(err) {
		t.Fatalf("nothing should be created or moved into the new directory (stat err=%v)", err)
	}
	t.Logf("custom data dir %s, old install %s and channels %s still used", data, oldDSH, oldCollab)

	// 新目录里已经有了（新装或已经在用）：只用新目录，不再读旧位置。
	if _, err := ExtractEmbeddedDSH(filepath.Join(data, "dsh")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(data, "conest-collab"), 0o700); err != nil {
		t.Fatal(err)
	}
	if got, _ := embeddedDSHDir(); got != filepath.Join(data, "dsh") {
		t.Fatalf("plugin dir = %q; want the custom one once it exists", got)
	}
	if got := collabDataDir(); got != filepath.Join(data, "conest-collab") {
		t.Fatalf("channel data = %q; want the custom one once it exists", got)
	}
}
