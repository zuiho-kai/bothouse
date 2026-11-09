package config

import (
	"errors"
	"fmt"
	"github.com/BurntSushi/toml"
	"github.com/chenhg5/cc-connect/core"
	"net/url"
	"os"
	"strings"
)

// QQSettingsUpdate is a partial update of a project's QQ (OneBot v11) platform
// options. nil fields are left untouched. A non-nil Token with an empty value
// removes the stored access token.
type QQSettingsUpdate struct {
	WSURL   *string
	HTTPURL *string
	Token   *string
	// AllowFrom is accepted only so the API can return a clear error: it has a
	// single writer, PATCH /projects/{name}'s platform_allow_from.
	AllowFrom             *string
	ShareSessionInChannel *bool

	// The remaining switches already exist in the adapter (platform/qq/qq.go:153-206)
	// and in config.example.toml:1884-1894, but had no way in from the panel. nil
	// still means "leave it alone"; the string fields treat "" as "drop the key".
	SplitBubbles     *bool
	AllowGroupsWith  *string
	CommandAllowFrom *string
	SaveImagesDir    *string
	AllowQzone       *bool
	AllowAvatar      *bool
}

// QQSettings is the non-secret view of a project's QQ (OneBot v11) platform.
// Token is never exposed; TokenSet only says whether one is stored.
type QQSettings struct {
	Configured            bool
	WSURL                 string
	HTTPURL               string
	TokenSet              bool
	AllowFrom             string
	ShareSessionInChannel bool
	SplitBubbles          bool
	AllowGroupsWith       string
	CommandAllowFrom      string
	SaveImagesDir         string
	AllowQzone            bool
	AllowAvatar           bool
}

var (
	// ErrInvalidQQSettings marks a rejected QQ settings value (HTTP 400), so the
	// management handler can tell it apart from a config read/write failure.
	// Aliased to core so the HTTP layer can match it with errors.Is.
	ErrInvalidQQSettings = core.ErrInvalidQQSettings
	// ErrQQPlatformMissing means the project has no qq platform entry yet; adding
	// a platform stays on POST /projects/{name}/add-platform.
	ErrQQPlatformMissing = core.ErrQQPlatformMissing
)

// GetQQSettings reads the first qq platform of a project from the config file.
// A project without a qq platform returns Configured=false (not an error).
func GetQQSettings(projectName string) (*QQSettings, error) {
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
		out := &QQSettings{}
		for _, plat := range p.Platforms {
			if plat.Type != "qq" {
				continue
			}
			out.Configured = true
			if v, ok := plat.Options["ws_url"].(string); ok {
				out.WSURL = v
			}
			if v, ok := plat.Options["http_url"].(string); ok {
				out.HTTPURL = v
			}
			if v, ok := plat.Options["token"].(string); ok && v != "" {
				out.TokenSet = true
			}
			if v, ok := plat.Options["allow_from"].(string); ok {
				out.AllowFrom = v
			}
			if v, ok := plat.Options["share_session_in_channel"].(bool); ok {
				out.ShareSessionInChannel = v
			}
			if v, ok := plat.Options["split_bubbles"].(bool); ok {
				out.SplitBubbles = v
			}
			if v, ok := plat.Options["allow_groups_with"].(string); ok {
				out.AllowGroupsWith = v
			}
			if v, ok := plat.Options["command_allow_from"].(string); ok {
				out.CommandAllowFrom = v
			}
			if v, ok := plat.Options["save_images_dir"].(string); ok {
				out.SaveImagesDir = v
			}
			if v, ok := plat.Options["allow_qzone"].(bool); ok {
				out.AllowQzone = v
			}
			if v, ok := plat.Options["allow_avatar"].(bool); ok {
				out.AllowAvatar = v
			}
			return out, nil
		}
		return out, nil
	}
	return nil, fmt.Errorf("project %q: %w", projectName, core.ErrProjectNotFound)
}

// UpdateQQSettings applies a partial update to a project's first qq platform and
// persists it. It returns the names of the fields that actually changed. The
// whole file is read and written back, so unrelated project/platform fields are
// preserved.
func UpdateQQSettings(projectName string, u QQSettingsUpdate) ([]string, error) {
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
			if platform["type"] == "qq" {
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
		return nil, fmt.Errorf("project %q: %w", projectName, ErrQQPlatformMissing)
	}

	changed := []string{}
	if u.WSURL != nil {
		v := strings.TrimSpace(*u.WSURL)
		if err := validateQQWSURL(v); err != nil {
			return nil, fmt.Errorf("%w: ws_url %v", ErrInvalidQQSettings, err)
		}
		if cur, _ := target["ws_url"].(string); cur != v {
			target["ws_url"] = v
			changed = append(changed, "ws_url")
		}
	}
	if u.HTTPURL != nil {
		v := strings.TrimSpace(*u.HTTPURL)
		if err := validateQQHTTPURL(v); err != nil {
			return nil, fmt.Errorf("%w: http_url %v", ErrInvalidQQSettings, err)
		}
		if cur, _ := target["http_url"].(string); cur != v {
			if v == "" {
				delete(target, "http_url")
			} else {
				target["http_url"] = v
			}
			changed = append(changed, "http_url")
		}
	}
	if u.Token != nil {
		v := strings.TrimSpace(*u.Token)
		if v == "" {
			if _, exists := target["token"]; exists {
				delete(target, "token")
				changed = append(changed, "token")
			}
		} else if cur, _ := target["token"].(string); cur != v {
			target["token"] = v
			changed = append(changed, "token")
		}
	}
	if u.AllowFrom != nil {
		// allow_from intentionally stays on PATCH /projects/{name}'s
		// platform_allow_from, so the project settings screen and this panel do
		// not become two writers of the same field.
		return nil, fmt.Errorf("%w: allow_from is saved through PATCH /projects/%s", ErrInvalidQQSettings, projectName)
	}
	if u.ShareSessionInChannel != nil {
		if cur, _ := target["share_session_in_channel"].(bool); cur != *u.ShareSessionInChannel {
			target["share_session_in_channel"] = *u.ShareSessionInChannel
			changed = append(changed, "share_session_in_channel")
		}
	}
	if u.SplitBubbles != nil {
		if cur, _ := target["split_bubbles"].(bool); cur != *u.SplitBubbles {
			target["split_bubbles"] = *u.SplitBubbles
			changed = append(changed, "split_bubbles")
		}
	}
	if u.AllowQzone != nil {
		if cur, _ := target["allow_qzone"].(bool); cur != *u.AllowQzone {
			target["allow_qzone"] = *u.AllowQzone
			changed = append(changed, "allow_qzone")
		}
	}
	if u.AllowAvatar != nil {
		if cur, _ := target["allow_avatar"].(bool); cur != *u.AllowAvatar {
			target["allow_avatar"] = *u.AllowAvatar
			changed = append(changed, "allow_avatar")
		}
	}
	for _, s := range []struct {
		key   string
		value *string
	}{
		{"allow_groups_with", u.AllowGroupsWith},
		{"command_allow_from", u.CommandAllowFrom},
		{"save_images_dir", u.SaveImagesDir},
	} {
		if s.value == nil {
			continue
		}
		v := strings.TrimSpace(*s.value)
		if cur, _ := target[s.key].(string); cur != v {
			// "" means "remove the key", the same convention http_url already
			// uses: an absent key is what the adapter reads as "not set".
			if v == "" {
				delete(target, s.key)
			} else {
				target[s.key] = v
			}
			changed = append(changed, s.key)
		}
	}
	if len(changed) == 0 {
		return changed, nil
	}
	if err := saveConfig(cfg); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	return changed, nil
}

func validateQQWSURL(raw string) error {
	if raw == "" {
		return errors.New("must not be empty")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.Host == "" {
		return errors.New("must be a ws:// or wss:// URL")
	}
	return nil
}

func validateQQHTTPURL(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("must be an http:// or https:// URL")
	}
	return nil
}
