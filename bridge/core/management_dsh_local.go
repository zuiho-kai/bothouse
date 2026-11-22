package core

import (
	"fmt"
	"net/http"
	"strings"
)

// Desktop's shell launch URL is delivered over IPC and may never appear in our logs.
func localDSHClient(transport http.RoundTripper) (dshAPI, bool) {
	host, ok := FindLocalDSHHost()
	if !ok {
		return dshAPI{}, false
	}
	return host.channelsClient(transport), true
}

func (h LocalDSHHost) channelsClient(transport http.RoundTripper) dshAPI {
	return dshAPI{
		target: h.target,
		rt: &dshLocalTransport{
			transport: transport,
			target:    h.target,
			token:     h.ownerToken,
		},
	}
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
