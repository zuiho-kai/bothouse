package main

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

// `bothouse features list` is what a role reads when asked whether a feature is on: each line
// carries the state, the plain name, the config key and a pending restart; inside a role's turn
// other roles' switches are left out.
func TestFormatFeatures(t *testing.T) {
	cfg := &config.Config{Projects: []config.ProjectConfig{{Name: "r1"}, {Name: "r2"}}}
	boot := config.FeatureValues(cfg)
	off := false
	cfg.StreamPreview.Enabled = &off
	cfg.Projects[0].TeamBoard = &off
	states := config.FeatureStates(cfg, boot)

	out := formatFeatures(states, "zh", "r1")
	for _, want := range []string{
		"【全局】", "【角色 r1】",
		"[关] 回复流式预览：", "stream_preview.enabled，默认开，配置已改，运行中的桥还是开，重启后生效",
		"[关] 团队状态板：", "（team_board，默认开）",
		"[开] 交回自动验收：", "team_review.disabled（反着写：开 = false）",
		"[关] 语音转文字：", "speech.enabled，默认关，改了要重启",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "r2") {
		t.Errorf("another role's switches are listed inside r1's turn:\n%s", out)
	}
	all := formatFeatures(states, "en", "")
	for _, want := range []string{"[global]", "[role r1]", "[role r2]", "[off] Streaming preview:", "[on] Team board:"} {
		if !strings.Contains(strings.ReplaceAll(all, "：", ":"), want) {
			t.Errorf("missing %q in:\n%s", want, all)
		}
	}
}
