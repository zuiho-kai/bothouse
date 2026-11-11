package core

// 缺口一和缺口二的两条用例（#1255 补正）。两条都只在删掉修复后变红：
//   - 缺口一：环境读不到时以前一律认（`return true, ""`），于是任何一台机器上别人的 `dsh --profile web`
//     都能被停掉；现在必须有本桥自己写下的记录（同一个 pid 的端口）才算。
//   - 缺口二：Windows 的进程查询自带 2s 超时，以前不看这一轮的 deadline，轮次用完预算后每个候选再花 2s；
//     现在查询跟着这一轮的 ctx 走。

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// A candidate's listener is evidence of liveness, not an independent bridge ownership record.
func TestDSHWebPortOwnedUnknownEnvRequiresBridgeRecord(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("BOTHOUSE_DATA_DIR", t.TempDir())
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	if pidListeningOnPort(port) != os.Getpid() {
		t.Skip("the platform cannot identify this listener")
	}
	old := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old })
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"dsh", "--profile", "web"}, nil, false, true
	}
	if ports := dshWebOwnPorts(os.Getpid()); len(ports) != 0 {
		t.Fatalf("expected no bridge records, got %v", ports)
	}
	if pid, owned, why := dshWebPortOwned(context.Background(), port); owned || pid != os.Getpid() {
		t.Fatalf("candidate listener without a bridge record: pid=%d owned=%v why=%q", pid, owned, why)
	} else if !strings.Contains(why, "no record of this bridge") {
		t.Fatalf("refused for the wrong reason: %s", why)
	}
	t.Log("real listener, EnvKnown=false, no bridge record: refused")

	// A port alone in state is still insufficient: the record must name this listener's pid.
	url := "http://127.0.0.1:" + port + "/?token=launch#channels"
	staleState(t, url, 0)
	if _, owned, why := dshWebPortOwned(context.Background(), port); owned {
		t.Fatalf("state without the listener pid was accepted: %s", why)
	}
	staleState(t, url, os.Getpid())
	if pid, owned, why := dshWebPortOwned(context.Background(), port); !owned || pid != os.Getpid() {
		t.Fatalf("recorded own listener refused: pid=%d owned=%v why=%q", pid, owned, why)
	}
	t.Log("same listener with matching bridge pid/port record: accepted")
}

// Exercise the panel route with a real HTTP listener; only the platform process metadata is stubbed.
func TestDSHWebSelfHealUnknownEnvRequiresBridgeRecord(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	t.Setenv("BOTHOUSE_DATA_DIR", t.TempDir())
	resetDSHWebHeal(t)
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	// Remove the fake's ownership shortcut so the real port/PID check is exercised.
	dshWebPortClaims.Lock()
	delete(dshWebPortClaims.m, port)
	dshWebPortClaims.Unlock()
	if pidListeningOnPort(port) != os.Getpid() {
		t.Skip("the platform cannot identify this listener")
	}
	old := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old })
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"dsh", "--profile", "web"}, nil, false, true
	}
	staleURL := fake.srv.URL + "/?token=stale#channels"
	announcement := "dsh web: " + fake.srv.URL + "/?token=launch"
	staleState(t, "http://127.0.0.1:1/?token=stale#channels", 0, announcement)
	before := readStateRaw(t)
	client := dshSignIn(t, panel, "secret")
	if status := getState(t, client, panel.URL); status != http.StatusServiceUnavailable {
		t.Fatalf("panel adopted unrecorded host: status=%d, want 503", status)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("unrecorded host rewrote bridge state: %s", after)
	}
	if fake.logins.Load() == 0 {
		t.Fatal("the host never accepted its launch token; ownership was not exercised")
	}
	t.Log("GET /dsh/collab/api/state: unrecorded host refused with 503; state unchanged")

	staleState(t, staleURL, os.Getpid(), announcement)
	resetDSHWebHeal(t)
	if status := getState(t, client, panel.URL); status != http.StatusOK {
		t.Fatalf("panel refused recorded own host: status=%d, want 200", status)
	}
	t.Log("GET /dsh/collab/api/state: recorded own host adopted with 200")
}

// 缺口一：Windows 上环境永远读不到（dsh_web_proc_windows.go），所以「命令行里有 --profile web」是必要
// 但不充分的条件——同一台机器上另一个 bothouse 的 dsh、用户自己手起的一个 dsh，都一样带着它。
// 以前这一步直接 return true，于是 stopDSHWebForImport 会把这个陌生进程停掉。
func TestDSHWebPIDOwnedLeavesAForeignHostOfUnknownEnvAlone(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sleep; the Windows lookup is covered by the same code path")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("BOTHOUSE_DATA_DIR", t.TempDir())
	cmd := exec.Command("/bin/sleep", "60")
	if err := cmd.Start(); err != nil {
		t.Skip("no sleep:", err)
	}
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	pid := cmd.Process.Pid

	old := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old })
	// 和 Windows 上看到的一样：命令行像我们的 host，环境读不到。
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"node", `C:\Users\ASUS\AppData\Roaming\npm\dsh.cmd`, "--profile", "web", "--no-open"},
			nil, false, true
	}

	if owned, why := dshWebPIDOwned(pid); owned {
		t.Fatalf("a dsh web of unknown environment was claimed as ours (%s)", why)
	} else if !strings.Contains(why, "no record of this bridge") {
		t.Fatalf("refused for the wrong reason: %s", why)
	}
	// 停的入口也必须什么都不做：这一条以前真的把这个 pid 杀掉。
	if err := stopDSHWebForImport(pid); err != nil {
		t.Fatalf("stopDSHWebForImport = %v, want nil", err)
	}
	if !processAlive(pid) {
		t.Fatal("a dsh web that is not this bridge's was stopped")
	}

	// 反过来：同一个 pid、同样读不到环境，只要本桥自己记下了「这个 pid 在这个端口上」，就仍然要认——
	// 不然真机（Windows）上自己的 host 会被拒，换角色后重启整个坏掉。
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	if pidListeningOnPort(port) != os.Getpid() {
		t.Skip("lsof cannot see this listener")
	}
	old2 := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old2 })
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"node", `C:\Users\ASUS\AppData\Roaming\npm\dsh.cmd`, "--profile", "web"},
			nil, false, true
	}
	state := DSHWeb{URL: "http://127.0.0.1:" + port + "/?token=t#channels", PID: os.Getpid()}
	b, _ := json.Marshal(state)
	if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dshWebStatePath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
	if owned, why := dshWebPIDOwned(os.Getpid()); !owned {
		t.Fatalf("our own host (recorded pid on a recorded port) was refused: %s", why)
	}
}

// 缺口二：轮次预算用完以后，每个候选不再各花一次平台查询的上限。这里把查询换成一个「一直等到 ctx
// 结束」的实现，再给这一轮 100ms——以前它每次都等满 2s，几个候选就是几个 2s。
func TestDSHWebPortOwnedDoesNotOutliveTheRoundDeadline(t *testing.T) {
	old := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old })
	var calls int
	dshWebProcLookup = func(ctx context.Context, pid int) ([]string, map[string]string, bool, bool) {
		calls++
		if ctx.Err() != nil {
			return nil, nil, false, false
		}
		select {
		case <-ctx.Done(): // 一次卡住的查询，只到这一轮的 deadline 为止
		case <-time.After(2 * time.Second):
		}
		return nil, nil, false, false
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())

	deadline := time.Now().Add(100 * time.Millisecond)
	start := time.Now()
	pid, owned, why := dshWebPortOwned(dshWebDeadlineCtx0(deadline), port)
	took := time.Since(start)
	if owned {
		t.Fatalf("pid %d was accepted although the round ended before the lookup answered (%s)", pid, why)
	}
	// 来源：一次查询的旧上限是 dshWebProcLookupTimeout（2s）；跟着这一轮走时不该超过 100ms 太多。
	const wantUnder = 1500 * time.Millisecond
	if took > wantUnder {
		t.Fatalf("the ownership check took %s for one candidate with a 100ms round: "+
			"the process lookup does not follow the round's deadline", took)
	}
	if calls != 1 {
		t.Fatalf("the lookup ran %d times for one candidate, want 1", calls)
	}
	// 预算用完之后再来：一个已经过期的轮次连一次查询都不该发起（N 个候选 × 2s 的来源）。
	expiredCtx := dshWebDeadlineCtx0(time.Now().Add(-time.Second))
	start = time.Now()
	if _, owned, _ := dshWebPortOwned(expiredCtx, port); owned {
		t.Fatal("an expired round still accepted a host")
	}
	if took := time.Since(start); took > 100*time.Millisecond {
		t.Fatalf("an expired round still spent %s on a lookup", took)
	}
	if calls != 1 {
		t.Fatalf("an expired round started another lookup (%d calls)", calls)
	}
	if strings.TrimSpace(why) == "" {
		t.Fatal("a refused ownership check must say why")
	}
}
