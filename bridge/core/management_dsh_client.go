package core

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
)

// dshAPI calls Channels through its local owner record or the legacy shell login.
type dshAPI struct {
	rt     http.RoundTripper
	target string
}

func (m *ManagementServer) dshClient() (dshAPI, dshStatus) {
	if c, ok := localDSHClient(m.dshProxyHandler().transport); ok {
		return c, dshStatus{Status: "running"}
	}
	target, launchToken, err := runningDSHWeb()
	if errors.Is(err, errDSHWebNotRunning) {
		// Discovery may heal a missing or malformed file from its log first. If it
		// could not, an existing unreadable file is an error, not a stopped host.
		if _, _, valid := readDSHWebState(); !valid {
			if _, statErr := os.Stat(dshWebStatePath()); statErr == nil || !os.IsNotExist(statErr) {
				return dshAPI{}, dshStatus{Status: "error", Error: dshHostStateReadable}
			}
		}
		return dshAPI{}, dshStatus{Status: "stopped"}
	}
	if err != nil {
		return dshAPI{}, dshStatus{Status: "error", Error: dshHostStateReadable}
	}
	return dshAPI{rt: &dshProxyTransport{p: m.dshProxyHandler(), target: target, launchToken: launchToken}, target: target}, dshStatus{Status: "running"}
}

func (c dshAPI) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, "http://"+c.target+path, body)
	if err != nil {
		return nil, err
	}
	req.Host = c.target // DSH's Host fence admits loopback only
	return req, nil
}

func (c dshAPI) get(ctx context.Context, path string, out any) error {
	req, err := c.newRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	res, err := c.rt.RoundTrip(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return &dshHTTPError{Path: path, Code: res.StatusCode}
	}
	return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out)
}
