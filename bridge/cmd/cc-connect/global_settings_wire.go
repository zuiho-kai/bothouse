package main

import (
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// wireGlobalSettings backs the settings page's global read/write pair (language, log level,
// attachment send, idle timeout, display, stream preview, rate limit, review tiers).
//
// Both the normal mode (main.go) and the setup wizard (setup_wizard.go runSetupOnly, a fresh
// install with no [[projects]] yet) wire it: the 系统 page is reachable in both, and setup-only
// installs are the first thing a new user sees (#1370). One implementation, so the two modes
// cannot drift apart.
func wireGlobalSettings(srv *core.ManagementServer) {
	srv.SetGetGlobalSettings(func() map[string]any {
		g := config.GetGlobalSettings()
		if n := core.TeamReviewModelNotice(); n != nil && g != nil {
			g["review_model_notice"] = n // read-only: a review model that did not take effect
		}
		return g
	})
	srv.SetSaveGlobalSettings(func(updates map[string]any) error {
		u := config.GlobalSettingsUpdate{}
		if v, ok := updates["language"].(string); ok {
			u.Language = &v
		}
		if v, ok := updates["attachment_send"].(string); ok {
			u.AttachmentSend = &v
		}
		if v, ok := updates["log_level"].(string); ok {
			u.LogLevel = &v
		}
		if v, ok := updates["idle_timeout_mins"].(float64); ok {
			iv := int(v)
			u.IdleTimeoutMins = &iv
		}
		if v, ok := updates["thinking_messages"].(bool); ok {
			u.ThinkingMessages = &v
		}
		if v, ok := updates["thinking_max_len"].(float64); ok {
			iv := int(v)
			u.ThinkingMaxLen = &iv
		}
		if v, ok := updates["tool_messages"].(bool); ok {
			u.ToolMessages = &v
		}
		if v, ok := updates["tool_max_len"].(float64); ok {
			iv := int(v)
			u.ToolMaxLen = &iv
		}
		if v, ok := updates["stream_preview_enabled"].(bool); ok {
			u.StreamPreviewOn = &v
		}
		if v, ok := updates["stream_preview_interval_ms"].(float64); ok {
			iv := int(v)
			u.StreamPreviewIntMs = &iv
		}
		if v, ok := updates["rate_limit_max_messages"].(float64); ok {
			iv := int(v)
			u.RateLimitMax = &iv
		}
		if v, ok := updates["rate_limit_window_secs"].(float64); ok {
			iv := int(v)
			u.RateLimitWindow = &iv
		}
		if v, ok := updates["review_simple_role"].(string); ok {
			u.ReviewSimpleRole = &v
		}
		if v, ok := updates["review_complex_role"].(string); ok {
			u.ReviewComplexRole = &v
		}
		if v, ok := updates["review_simple_model"].(string); ok {
			u.ReviewSimpleModel = &v
		}
		if v, ok := updates["review_complex_model"].(string); ok {
			u.ReviewComplexModel = &v
		}
		if err := config.SaveGlobalSettings(u); err != nil {
			return err
		}
		if u.ReviewSimpleRole != nil || u.ReviewComplexRole != nil || u.ReviewSimpleModel != nil || u.ReviewComplexModel != nil {
			// Applies at the next review scan; no restart.
			if g := config.GetGlobalSettings(); g != nil {
				simple, _ := g["review_simple_role"].(string)
				complex, _ := g["review_complex_role"].(string)
				core.SetTeamReviewTiers(simple, complex)
				simpleModel, _ := g["review_simple_model"].(string)
				complexModel, _ := g["review_complex_model"].(string)
				core.SetTeamReviewModels(simpleModel, complexModel)
			}
		}
		return nil
	})
}
