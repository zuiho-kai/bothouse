package accountquota

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"golang.org/x/net/http/httpproxy"
)

func cursorHTTPClient(ctx context.Context, env []string) *http.Client {
	client := httpClient()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	cfg := httpproxy.Config{HTTPProxy: proxyEnv(env, "HTTP_PROXY"), HTTPSProxy: proxyEnv(env, "HTTPS_PROXY"), NoProxy: proxyEnv(env, "NO_PROXY")}
	if runtime.GOOS == "darwin" && !hasProxyEnv(env) {
		// Cursor honors macOS networking settings. Go's default client only reads
		// process env, which otherwise bypasses the user's working system proxy.
		if raw, err := exec.CommandContext(ctx, "/usr/sbin/scutil", "--proxy").Output(); err == nil {
			cfg.HTTPSProxy = macHTTPSProxy(string(raw))
		}
	}
	proxy := cfg.ProxyFunc()
	transport.Proxy = func(r *http.Request) (*url.URL, error) { return proxy(r.URL) }
	client.Transport = transport
	return client
}

func proxyEnv(env []string, key string) string {
	if v := envValue(env, key); v != "" {
		return v
	}
	return envValue(env, strings.ToLower(key))
}

func hasProxyEnv(env []string) bool {
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		if strings.EqualFold(k, "HTTPS_PROXY") || strings.EqualFold(k, "HTTP_PROXY") {
			return true
		}
	}
	return false
}

func macHTTPSProxy(raw string) string {
	values := make(map[string]string)
	for _, line := range strings.Split(raw, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), " : ")
		if ok {
			values[k] = v
		}
	}
	if values["HTTPSEnable"] != "1" {
		return ""
	}
	host := values["HTTPSProxy"]
	port, err := strconv.Atoi(values["HTTPSPort"])
	if host == "" || strings.ContainsAny(host, "/@?# \t\n") || err != nil || port < 1 || port > 65535 {
		return ""
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port))
}
