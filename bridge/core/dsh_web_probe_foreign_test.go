package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// #2078：公告没有端口时桥要从本机监听里找自己的 dsh。别人的口（FutuOpenD 的 telnet 登录台 22222）
// 收到探活的 HTTP 请求，把每行当成账号密码，登录失败后重启成未登录，交易那路 OpenD 一直起不来。
// 不是本桥宿主的口，一个请求都不能收到。
func TestDSHWebSelfHealSendsNothingToAForeignListener(t *testing.T) {
	setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	var hits atomic.Int32
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	t.Cleanup(foreign.Close)
	port := strings.TrimPrefix(foreign.URL, "http://127.0.0.1:")
	claimDSHWebPort(t, port, false)
	old := dshWebListenersFn
	t.Cleanup(func() { dshWebListenersFn = old })
	dshWebListenersFn = func(context.Context) []string { return []string{port} }

	staleState(t, "http://127.0.0.1:1/?token=gone#channels", 0,
		"dsh web: https://mac-mini.example.ts.net/?token=launch")
	if _, _, ok := healDSHWebState(stateForTest(t)); ok {
		t.Fatal("a listener that is not this bridge's host was adopted")
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("a listener that is not this bridge's host received %d HTTP requests, want 0", n)
	}
}
