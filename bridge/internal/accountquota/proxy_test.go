package accountquota

import (
	"context"
	"net/http"
	"testing"
)

func TestCursorUsesConfiguredProxyAndSystemProxySyntax(t *testing.T) {
	got := macHTTPSProxy("<dictionary> {\n  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7897\n}")
	if got != "http://127.0.0.1:7897" {
		t.Fatal(got)
	}
	if macHTTPSProxy("HTTPSEnable : 0\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897") != "" {
		t.Fatal("disabled proxy used")
	}
	c := cursorHTTPClient(context.Background(), []string{"HTTPS_PROXY=http://127.0.0.1:43210"})
	defer c.CloseIdleConnections()
	req, _ := http.NewRequest("POST", cursorEndpoint, nil)
	proxy, err := c.Transport.(*http.Transport).Proxy(req)
	if err != nil || proxy == nil || proxy.String() != "http://127.0.0.1:43210" {
		t.Fatalf("agent env proxy ignored: %v %v", proxy, err)
	}
}
