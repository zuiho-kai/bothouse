package acp

import (
	"encoding/json"
	"testing"
)

func parseResult(t *testing.T, raw string) acpModelInfo {
	t.Helper()
	var r struct {
		Models        *acpModelsBlock   `json:"models"`
		ConfigOptions []acpConfigOption `json:"configOptions"`
	}
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		t.Fatal(err)
	}
	return parseModelInfo(r.Models, r.ConfigOptions)
}

// Shapes captured from the real CLIs on 2026-10-16.
func TestParseModelInfoGrok(t *testing.T) {
	info := parseResult(t, `{"models":{"currentModelId":"grok-4.7","availableModels":[{"modelId":"grok-4.7","name":"grok-4.7"},{"modelId":"codegoai-grok","name":"codegoai-grok"}]},
	 "configOptions":[{"id":"model","category":"model","currentValue":"grok-4.7","options":[{"value":"grok-4.7","name":"grok-4.7"}]},
	                  {"id":"reasoning_effort","category":"thought_level","currentValue":"high","options":[{"value":"xhigh"},{"value":"high"},{"value":"medium"},{"value":"low"}]}]}`)
	if !info.viaSetModel || info.viaConfig || len(info.models) != 2 || info.currentModel != "grok-4.7" {
		t.Fatalf("grok models: %+v", info)
	}
	if info.effortConfig != "reasoning_effort" || len(info.efforts) != 4 || info.currentEff != "high" {
		t.Fatalf("grok effort: %+v", info)
	}
}

func TestParseModelInfoDeepSeekGroupedConfig(t *testing.T) {
	info := parseResult(t, `{"configOptions":[{"id":"model","name":"Model","category":"model","type":"select",
	 "currentValue":"[\"codegoai-deepseek\",\"deepseek-v4.1-flash\"]",
	 "options":[{"group":"deepseek-official","name":"DeepSeek","options":[{"value":"[\"deepseek-official\",\"deepseek-v4-pro\"]","name":"DeepSeek-V4-Pro"}]},
	            {"group":"codegoai-deepseek","name":"codegoai-deepseek","options":[{"value":"[\"codegoai-deepseek\",\"deepseek-v4.1-flash\"]","name":"DeepSeek-V4.1-Flash"}]}]}]}`)
	if info.viaSetModel || !info.viaConfig || len(info.models) != 2 {
		t.Fatalf("deepseek: %+v", info)
	}
	if info.currentModel != `["codegoai-deepseek","deepseek-v4.1-flash"]` {
		t.Fatalf("current = %q", info.currentModel)
	}
	if info.models[0].Alias != "DeepSeek DeepSeek-V4-Pro" {
		t.Fatalf("alias should carry group + name for matching/display: %q", info.models[0].Alias)
	}
	if info.effortConfig != "" {
		t.Fatalf("deepseek has no effort option: %+v", info)
	}
}

func TestParseModelInfoCursorPrefersSetModel(t *testing.T) {
	info := parseResult(t, `{"models":{"currentModelId":"composer-2.5[fast=true]","availableModels":[{"modelId":"composer-2.5[fast=true]","name":"composer-2.5"}]},
	 "configOptions":[{"id":"mode","options":[{"value":"agent"}]},{"id":"model","options":[{"value":"composer-2.5[fast=true]"}]}]}`)
	if !info.viaSetModel || info.viaConfig || len(info.models) != 1 {
		t.Fatalf("cursor: %+v", info)
	}
}

func TestAgentModelReporting(t *testing.T) {
	a := &Agent{}
	a.reportModelInfo(acpModelInfo{models: nil, currentModel: "grok-4.7", efforts: []string{"high", "low"}, currentEff: "high"})
	if a.GetModel() != "grok-4.7" || a.GetReasoningEffort() != "high" || len(a.AvailableReasoningEfforts()) != 2 {
		t.Fatalf("advertised values not reported: model=%q effort=%q", a.GetModel(), a.GetReasoningEffort())
	}
	a.SetModel("codegoai-grok")
	a.SetReasoningEffort("low")
	if a.GetModel() != "codegoai-grok" || a.GetReasoningEffort() != "low" {
		t.Fatal("explicit choice should win over advertised value")
	}
}
