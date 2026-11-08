package core

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestPluginLockRespectsDSHTakeoverClaim(t *testing.T) {
	// A completed child gives us a proven dead PID without guessing an unused PID.
	child := exec.Command(os.Args[0], "-test.run=^$")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	record := []byte(fmt.Sprintf("%d\n", child.Process.Pid))
	manifest := filepath.Join(t.TempDir(), "package.json")
	lock := manifest + ".lock"
	if err := os.WriteFile(lock, record, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(record)
	// DSH atomic-write uses the first 16 hexadecimal SHA256 characters for its claim.
	claim := fmt.Sprintf("%s.takeover-%x", lock, digest[:8])
	if err := os.WriteFile(claim, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- withPluginProfileLock(manifest, func() error {
			close(entered)
			return nil
		})
	}()
	select {
	case <-entered:
		t.Fatal("Go writer entered while DSH held the dead-lock takeover claim")
	case <-time.After(100 * time.Millisecond):
	}
	if err := os.Remove(claim); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("writer did not recover after the DSH takeover claim was released")
	}
}

func TestPluginLockDoesNotTakeOverLiveOrIncompleteRecords(t *testing.T) {
	for _, record := range []string{
		fmt.Sprintf("%d\n", os.Getpid()),
		"", "0\n", "-1\n", "2147483648\n", "123", "123\nextra", "+123\n",
	} {
		t.Run(fmt.Sprintf("%q", record), func(t *testing.T) {
			lock := filepath.Join(t.TempDir(), "package.json.lock")
			if err := os.WriteFile(lock, []byte(record), 0o600); err != nil {
				t.Fatal(err)
			}
			removed, err := takeOverExitedPluginLock(lock)
			if err != nil || removed {
				t.Fatalf("unproven dead holder removed=%v err=%v", removed, err)
			}
			raw, err := os.ReadFile(lock)
			if err != nil || string(raw) != record {
				t.Fatalf("record changed: %q, %v", raw, err)
			}
		})
	}
}

// TestPluginLockKeepsLiveRecordWrittenUnderClaim 是那个决定性窗口的确定性复现：
// 拿到 claim 之后、重读之前，另一个写者已经把死记录换成了自己的活记录。旧实现
// 直接删，删掉的是活锁；现在必须放手，活锁保留。
func TestPluginLockKeepsLiveRecordWrittenUnderClaim(t *testing.T) {
	child := exec.Command(os.Args[0], "-test.run=^$")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "package.json")
	lock := manifest + ".lock"
	if err := os.WriteFile(lock, []byte(fmt.Sprintf("%d\n", child.Process.Pid)), 0o600); err != nil {
		t.Fatal(err)
	}
	// 别人接管成功后写下自己的活记录：用本进程 pid（一定活着），不猜空闲 pid。
	live := []byte(fmt.Sprintf("%d\n", os.Getpid()))
	pluginLockAfterClaim = func() {
		if err := os.WriteFile(lock, live, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	defer func() { pluginLockAfterClaim = nil }()

	removed, err := takeOverExitedPluginLock(lock)
	if err != nil {
		t.Fatalf("接管失败：%v", err)
	}
	if removed {
		t.Fatal("重读时记录已变，不该删——那会删掉别人的活锁")
	}
	raw, err := os.ReadFile(lock)
	if err != nil || string(raw) != string(live) {
		t.Fatalf("活锁被动过：%q %v", raw, err)
	}
}

// TestPluginLockKeepsChangedRecordEvenIfItLooksDead：拿到 claim 之后记录被别人换成了
// **另一条死记录**。这条仍然不能删——claim 是给「我读到的那一份」算的哈希，换了内容
// 就不是我该处理的那一条，删了会连累别人已经开始的接管。只有重读比对内容能挡住它。
func TestPluginLockKeepsChangedRecordEvenIfItLooksDead(t *testing.T) {
	first := exec.Command(os.Args[0], "-test.run=^$")
	if err := first.Run(); err != nil {
		t.Fatal(err)
	}
	second := exec.Command(os.Args[0], "-test.run=^$")
	if err := second.Run(); err != nil {
		t.Fatal(err)
	}
	lock := filepath.Join(t.TempDir(), "package.json.lock")
	if err := os.WriteFile(lock, []byte(fmt.Sprintf("%d\n", first.Process.Pid)), 0o600); err != nil {
		t.Fatal(err)
	}
	changed := []byte(fmt.Sprintf("%d\n", second.Process.Pid))
	pluginLockAfterClaim = func() {
		if err := os.WriteFile(lock, changed, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	defer func() { pluginLockAfterClaim = nil }()

	removed, err := takeOverExitedPluginLock(lock)
	if err != nil {
		t.Fatalf("接管失败：%v", err)
	}
	if removed {
		t.Fatal("记录已被换成别人 claim 的那一条，不该删")
	}
	raw, err := os.ReadFile(lock)
	if err != nil || string(raw) != string(changed) {
		t.Fatalf("记录被动过：%q %v", raw, err)
	}
}

// TestPluginLockTwoContendersSameDeadLock：两个竞争者同时接管同一份死锁，只能有一个
// 真正删掉并进驻；另一个要么拿不到 claim，要么重读后发现记录已变而放手。谁赢都行，
// 但不许两边都「成功」，更不许把赢家的活记录删掉。
func TestPluginLockTwoContendersSameDeadLock(t *testing.T) {
	child := exec.Command(os.Args[0], "-test.run=^$")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(t.TempDir(), "package.json")
	lock := manifest + ".lock"
	dead := []byte(fmt.Sprintf("%d\n", child.Process.Pid))
	if err := os.WriteFile(lock, dead, 0o600); err != nil {
		t.Fatal(err)
	}

	const contenders = 2
	results := make(chan bool, contenders)
	start := make(chan struct{})
	for i := 0; i < contenders; i++ {
		go func() {
			<-start
			removed, err := takeOverExitedPluginLock(lock)
			if err != nil {
				results <- false
				return
			}
			results <- removed
		}()
	}
	close(start)
	won := 0
	for i := 0; i < contenders; i++ {
		if <-results {
			won++
		}
	}
	if won != 1 {
		t.Fatalf("同一份死锁该只有一个接管成功，实际 %d", won)
	}
	// 赢家删掉后锁文件应当不在（没有别人再写）；claim 也必须清干净。
	if _, err := os.Stat(lock); err == nil {
		t.Fatal("接管成功后死锁不该还在")
	}
	claims, _ := filepath.Glob(lock + ".takeover-*")
	if len(claims) != 0 {
		t.Fatalf("claim 没清干净：%v", claims)
	}
}

// TestPluginLockTakeoverRefusesPartialRecord：记录只写了半个 pid（进程被杀在中途）时，
// 不能当作「持有者已退出」而接管——dsH 自己的 holderExited 也要求完整记录。
func TestPluginLockTakeoverRefusesPartialRecord(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "package.json.lock")
	if err := os.WriteFile(lock, []byte("12"), 0o600); err != nil {
		t.Fatal(err)
	}
	removed, err := takeOverExitedPluginLock(lock)
	if err != nil || removed {
		t.Fatalf("半个 pid 不该被接管：removed=%v err=%v", removed, err)
	}
}
