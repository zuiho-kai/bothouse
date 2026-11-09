package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/chenhg5/cc-connect/core"
)

// QQBotSettingsUpdate is a partial update of a project's official QQ Bot
// (platform type "qqbot") options. nil fields are left untouched. A non-nil
// AppSecret with an empty value keeps the stored secret — the panel cannot show
// it, so a blank field must mean "unchanged", not "delete the bot's credential".
type QQBotSettingsUpdate struct {
	// AppSecret is write-only: the browser never receives it back.
	AppSecret *string
	// Sandbox switches the official API between the sandbox and production
	// endpoints (platform/qqbot/qqbot.go reads "sandbox").
	Sandbox *bool
	// ShareSessionInChannel and MarkdownSupport are the other two switches the
	// adapter reads (platform/qqbot/qqbot.go:166-168) and config.example.toml
	// documents; both were only settable by editing config.toml by hand.
	ShareSessionInChannel *bool
	MarkdownSupport       *bool
	// AllowFrom is accepted only so the API can return a clear 400: PATCH
	// /projects/{name}'s platform_allow_from is its single writer, the same rule
	// the QQ (OneBot) panel follows.
	AllowFrom *string
}

// QQBotSettings is the non-secret view of a project's official QQ Bot platform.
// app_id is not echoed either: the panel only needs to know one is stored, and
// the AppID is part of the bot's identity rather than something to retype.
type QQBotSettings struct {
	Configured            bool
	AppIDSet              bool
	AppSecretSet          bool
	Sandbox               bool
	AllowFrom             string
	ShareSessionInChannel bool
	MarkdownSupport       bool
}

var (
	// ErrInvalidQQBotSettings marks a rejected official-Bot settings value
	// (HTTP 400), so the handler can tell it from a config read/write failure.
	ErrInvalidQQBotSettings = core.ErrInvalidQQBotSettings
	// ErrQQBotPlatformMissing means the project has no qqbot platform entry yet.
	ErrQQBotPlatformMissing = core.ErrQQBotPlatformMissing
)

// GetQQBotSettings reads the first qqbot platform of a project. A project
// without one returns Configured=false rather than an error.
func GetQQBotSettings(projectName string) (*QQBotSettings, error) {
	if ConfigPath == "" {
		return nil, fmt.Errorf("config path not set")
	}
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	cfg := &Config{}
	if err := toml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	for _, p := range cfg.Projects {
		if p.Name != projectName {
			continue
		}
		out := &QQBotSettings{}
		for _, plat := range p.Platforms {
			if plat.Type != "qqbot" {
				continue
			}
			out.Configured = true
			if v, ok := plat.Options["app_id"].(string); ok && v != "" {
				out.AppIDSet = true
			}
			if v, ok := plat.Options["app_secret"].(string); ok && v != "" {
				out.AppSecretSet = true
			}
			if v, ok := plat.Options["sandbox"].(bool); ok {
				out.Sandbox = v
			}
			if v, ok := plat.Options["allow_from"].(string); ok {
				out.AllowFrom = v
			}
			if v, ok := plat.Options["share_session_in_channel"].(bool); ok {
				out.ShareSessionInChannel = v
			}
			if v, ok := plat.Options["markdown_support"].(bool); ok {
				out.MarkdownSupport = v
			}
			return out, nil
		}
		return out, nil
	}
	return nil, fmt.Errorf("project %q: %w", projectName, core.ErrProjectNotFound)
}

// UpdateQQBotSettings applies a partial update to a project's first qqbot
// platform and persists it, returning the fields that actually changed. The
// whole file is read and written back, so unrelated settings are preserved.
func UpdateQQBotSettings(projectName string, u QQBotSettingsUpdate) ([]string, error) {
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return nil, fmt.Errorf("config path not set")
	}
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg map[string]any
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	var target map[string]any
	foundProject := false
	projects, _ := cfg["projects"].([]map[string]any)
	for _, p := range projects {
		if p["name"] != projectName {
			continue
		}
		foundProject = true
		platforms, _ := p["platforms"].([]map[string]any)
		for _, platform := range platforms {
			if platform["type"] == "qqbot" {
				target, _ = platform["options"].(map[string]any)
				if target == nil {
					target = map[string]any{}
					platform["options"] = target
				}
				break
			}
		}
		break
	}
	if !foundProject {
		return nil, fmt.Errorf("project %q: %w", projectName, core.ErrProjectNotFound)
	}
	if target == nil {
		return nil, fmt.Errorf("project %q: %w", projectName, ErrQQBotPlatformMissing)
	}

	changed := []string{}
	if u.AppSecret != nil {
		// "" keeps the stored secret: the form cannot prefill it, so an empty box
		// is a user who did not touch the field, not one who wants it removed.
		v := strings.TrimSpace(*u.AppSecret)
		if v != "" {
			if cur, _ := target["app_secret"].(string); cur != v {
				target["app_secret"] = v
				changed = append(changed, "app_secret")
			}
		}
	}
	for _, s := range []struct {
		key   string
		value *bool
	}{
		{"sandbox", u.Sandbox},
		{"share_session_in_channel", u.ShareSessionInChannel},
		{"markdown_support", u.MarkdownSupport},
	} {
		if s.value == nil {
			continue
		}
		if cur, _ := target[s.key].(bool); cur != *s.value {
			target[s.key] = *s.value
			changed = append(changed, s.key)
		}
	}
	if u.AllowFrom != nil {
		return nil, fmt.Errorf("%w: allow_from is saved through PATCH /projects/%s", ErrInvalidQQBotSettings, projectName)
	}
	if len(changed) == 0 {
		return changed, nil
	}
	if err := saveConfig(cfg); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	return changed, nil
}
