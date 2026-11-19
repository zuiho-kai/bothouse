package core

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// The Channels plugin publishes this private record after acquiring its data lock.
// Desktop's shell launch URL is delivered over IPC and may never appear in our logs.
func localDSHClient(transport http.RoundTripper) (dshAPI, bool) {
	b, err := os.ReadFile(filepath.Join(collabDataDir(), "collab.owner.json"))
	if err != nil {
		return dshAPI{}, false
	}
	var owner struct {
		PID   int `json:"pid"`
		Local struct {
			Origin string `json:"origin"`
			Token  string `json:"token"`
		} `json:"local"`
	}
	if json.Unmarshal(b, &owner) != nil || owner.PID <= 0 || !processAlive(owner.PID) {
		return dshAPI{}, false
	}
	u, err := url.Parse(owner.Local.Origin)
	if err != nil || u.Scheme != "http" || u.User != nil || u.Opaque != "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return dshAPI{}, false
	}
	ip := net.ParseIP(u.Hostname())
	port, err := strconv.Atoi(u.Port())
	if ip == nil || !ip.IsLoopback() || err != nil || port < 1 || port > 65535 ||
		owner.Local.Token == "" || strings.ContainsAny(owner.Local.Token, "\r\n") {
		return dshAPI{}, false
	}
	return dshAPI{
		target: u.Host,
		rt: &dshLocalTransport{
			transport: transport,
			target:    u.Host,
			token:     owner.Local.Token,
		},
	}, true
}

// The local owner credential applies to Channels routes, not the DSH shell.
type dshLocalTransport struct {
	transport http.RoundTripper
	target    string
	token     string
}

func (t *dshLocalTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "http" || req.URL.Host != t.target ||
		(req.URL.Path != "/collab" && !strings.HasPrefix(req.URL.Path, "/collab/")) {
		return nil, fmt.Errorf("DSH local connection requires a Channels route on its recorded host")
	}
	out := req.Clone(req.Context())
	out.Host = t.target
	out.Header.Del("Authorization")
	out.Header.Del("Cookie")
	out.Header.Set("X-Collab-Local", t.token)
	return t.transport.RoundTrip(out)
}
