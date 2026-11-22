package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: messages the bot posts in a team workspace channel are sent with
// SUPPRESS_NOTIFICATIONS (the @silent flag), so busy workspaces in a shared server
// do not push a notification to every member. Human mentions must also be
// excluded: SUPPRESS_NOTIFICATIONS alone still allows mentions (#1951).
// Chat channels are unchanged.

const messageFlagSuppressNotifications = 1 << 12

var channelMessagesPath = regexp.MustCompile(`/channels/(\d+)/messages(?:/\d+)?$`)

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

// silentTransport applies the workspace channel policy to channel message
// creates and edits, including multipart uploads. Interaction webhooks carry
// the same mention policy at their call site, where their channel ID is known.
type silentTransport struct {
	base         http.RoundTripper
	isSilent     func(channelID string) bool
	mentionUsers func() []string
}

func (t *silentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if (req.Method == http.MethodPost || req.Method == http.MethodPatch) && req.Body != nil {
		if m := channelMessagesPath.FindStringSubmatch(req.URL.Path); m != nil && t.isSilent(m[1]) {
			var users []string
			if t.mentionUsers != nil {
				users = t.mentionUsers()
			}
			r, err := withSilentFlag(req, users)
			if err != nil {
				return nil, fmt.Errorf("discord: workspace message policy: %w", err)
			}
			req = r
		}
	}
	return t.base.RoundTrip(req)
}

func withSilentFlag(req *http.Request, users []string) (*http.Request, error) {
	body, err := io.ReadAll(req.Body)
	req.Body.Close()
	if err != nil {
		return nil, err
	}
	out := body
	mediaType, params, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	switch {
	case mediaType == "application/json":
		if b, ok := addFlag(body, users, req.Method == http.MethodPost); ok {
			out = b
		} else {
			return nil, fmt.Errorf("invalid message JSON")
		}
	case strings.HasPrefix(mediaType, "multipart/") && params["boundary"] != "":
		if b, ok := addFlagMultipart(body, params["boundary"], users, req.Method == http.MethodPost); ok {
			out = b
		} else {
			return nil, fmt.Errorf("invalid message multipart payload")
		}
	default:
		return nil, fmt.Errorf("unsupported message content type %q", mediaType)
	}
	r := req.Clone(req.Context())
	r.Body = io.NopCloser(bytes.NewReader(out))
	r.ContentLength = int64(len(out))
	r.Header.Set("Content-Length", strconv.Itoa(len(out)))
	r.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(out)), nil }
	return r, nil
}

func addFlag(body []byte, users []string, suppress bool) ([]byte, bool) {
	var obj map[string]json.RawMessage
	if json.Unmarshal(body, &obj) != nil || obj == nil {
		return nil, false
	}
	if suppress {
		var flags int
		if raw, ok := obj["flags"]; ok {
			_ = json.Unmarshal(raw, &flags)
		}
		obj["flags"] = json.RawMessage(strconv.Itoa(flags | messageFlagSuppressNotifications))
	}
	var original *discordgo.MessageAllowedMentions
	if raw := obj["allowed_mentions"]; raw != nil {
		if json.Unmarshal(raw, &original) != nil {
			return nil, false
		}
	}
	mentions, err := json.Marshal(workspaceAllowedMentions(users, original))
	if err != nil {
		return nil, false
	}
	obj["allowed_mentions"] = mentions
	b, err := json.Marshal(obj)
	return b, err == nil
}

// addFlagMultipart rewrites the payload_json part of a file upload.
func addFlagMultipart(body []byte, boundary string, users []string, suppress bool) ([]byte, bool) {
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
			if b, ok := addFlag(data, users, suppress); ok {
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

// Use only registered bot identities, never allow_from or allow_bots (which may
// contain wildcards or webhook authors). Preserve an explicitly narrower policy.
func workspaceAllowedMentions(users []string, original *discordgo.MessageAllowedMentions) *discordgo.MessageAllowedMentions {
	allowed := &discordgo.MessageAllowedMentions{Parse: []discordgo.AllowedMentionType{}}
	for _, id := range users {
		if original == nil || slices.Contains(original.Parse, discordgo.AllowedMentionTypeUsers) || slices.Contains(original.Users, id) {
			allowed.Users = append(allowed.Users, id)
		}
	}
	return allowed
}

func (p *Platform) workspaceMentionUsers() []string {
	var users []string
	teamPlatforms.Range(func(key, _ any) bool {
		users = append(users, key.(string))
		return true
	})
	sort.Strings(users)
	return users
}

// SetHumanMentionGate implements core.HumanMentionGateAware (#2091).
func (p *Platform) SetHumanMentionGate(enabled func() bool) {
	if enabled == nil {
		p.humanMentionGate.Store(nil)
		return
	}
	p.humanMentionGate.Store(&enabled)
}

func (p *Platform) humanMentionGateEnabled() bool {
	f := p.humanMentionGate.Load()
	return f != nil && (*f)()
}

// outboundAllowedMentions returns Discord's allowed_mentions for a bot text message (#2091).
// While mention_human_gate is off (the default), it returns nil so Discord preserves its
// standard mention behavior (workspace channels still enforce workspaceAllowedMentions via
// silentTransport). While mention_human_gate is on, human mentions, @everyone/@here and role
// mentions are suppressed while registered teammate bots may still mention each other; only an
// explicit core.WithAllowHumanMentions context (release posts and decision asks) lets named
// human user IDs notify, and never in a silent workspace channel (#1951).
func (p *Platform) outboundAllowedMentions(ctx context.Context, channelID string, allowHuman bool) *discordgo.MessageAllowedMentions {
	if !p.humanMentionGateEnabled() {
		return nil
	}
	allowed := &discordgo.MessageAllowedMentions{Parse: []discordgo.AllowedMentionType{}}
	seen := make(map[string]struct{})
	for _, id := range p.workspaceMentionUsers() {
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
		allowed.Users = append(allowed.Users, id)
	}
	if allowHuman && !p.isSilentChannel(channelID) {
		for _, id := range core.AllowedHumanMentions(ctx) {
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			allowed.Users = append(allowed.Users, id)
		}
	}
	return allowed
}

func discordReqOptions(ctx context.Context) []discordgo.RequestOption {
	if ctx == nil {
		return nil
	}
	return []discordgo.RequestOption{discordgo.WithContext(ctx)}
}

// Interaction webhook URLs do not contain their channel ID. Apply the same
// channel / mention-gate policy where the interaction still carries its structured channel.
func (p *Platform) interactionAllowedMentions(ctx context.Context, channelID string, allowHuman bool) *discordgo.MessageAllowedMentions {
	if !p.humanMentionGateEnabled() {
		if !p.isSilentChannel(channelID) {
			return nil
		}
		return workspaceAllowedMentions(p.workspaceMentionUsers(), nil)
	}
	return p.outboundAllowedMentions(ctx, channelID, allowHuman)
}
