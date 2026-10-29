package discord

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// maomao fork: messages the bot posts in a team workspace channel are sent with
// SUPPRESS_NOTIFICATIONS (the @silent flag), so busy workspaces in a shared server
// do not push a notification to every member. Chat channels are unchanged.

const messageFlagSuppressNotifications = 1 << 12

var channelMessagesPath = regexp.MustCompile(`/channels/(\d+)/messages$`)

// SetSilentChannel implements core.SilentChannelAware.
func (p *Platform) SetSilentChannel(isSilent func(channelID string) bool) {
	if isSilent == nil {
		p.silentChannel.Store(nil)
		return
	}
	p.silentChannel.Store(&isSilent)
}

func (p *Platform) isSilentChannel(channelID string) bool {
	f := p.silentChannel.Load()
	return f != nil && (*f)(channelID)
}

// silentTransport adds the suppress-notifications flag to new messages posted in a
// silent channel. It covers every send path, since they all go through the session client.
type silentTransport struct {
	base     http.RoundTripper
	isSilent func(channelID string) bool
}

func (t *silentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Method == http.MethodPost && req.Body != nil {
		if m := channelMessagesPath.FindStringSubmatch(req.URL.Path); m != nil && t.isSilent(m[1]) {
			if r, err := withSilentFlag(req); err == nil {
				req = r
			}
		}
	}
	return t.base.RoundTrip(req)
}

func withSilentFlag(req *http.Request) (*http.Request, error) {
	body, err := io.ReadAll(req.Body)
	req.Body.Close()
	if err != nil {
		return nil, err
	}
	out := body
	mediaType, params, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	switch {
	case mediaType == "application/json":
		if b, ok := addFlag(body); ok {
			out = b
		}
	case strings.HasPrefix(mediaType, "multipart/") && params["boundary"] != "":
		if b, ok := addFlagMultipart(body, params["boundary"]); ok {
			out = b
		}
	}
	r := req.Clone(req.Context())
	r.Body = io.NopCloser(bytes.NewReader(out))
	r.ContentLength = int64(len(out))
	r.Header.Set("Content-Length", strconv.Itoa(len(out)))
	r.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(out)), nil }
	return r, nil
}

func addFlag(body []byte) ([]byte, bool) {
	var obj map[string]json.RawMessage
	if json.Unmarshal(body, &obj) != nil || obj == nil {
		return nil, false
	}
	var flags int
	if raw, ok := obj["flags"]; ok {
		_ = json.Unmarshal(raw, &flags)
	}
	obj["flags"] = json.RawMessage(strconv.Itoa(flags | messageFlagSuppressNotifications))
	b, err := json.Marshal(obj)
	return b, err == nil
}

// addFlagMultipart rewrites the payload_json part of a file upload.
func addFlagMultipart(body []byte, boundary string) ([]byte, bool) {
	mr := multipart.NewReader(bytes.NewReader(body), boundary)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if mw.SetBoundary(boundary) != nil {
		return nil, false
	}
	changed := false
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, false
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return nil, false
		}
		if part.FormName() == "payload_json" {
			if b, ok := addFlag(data); ok {
				data, changed = b, true
			}
		}
		w, err := mw.CreatePart(part.Header)
		if err != nil {
			return nil, false
		}
		w.Write(data)
	}
	if mw.Close() != nil || !changed {
		return nil, false
	}
	return buf.Bytes(), true
}
