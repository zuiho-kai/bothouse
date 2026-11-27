package acp

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
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
	// #2071: the route pair is not a model id; the catalog shows the model and keeps the pair for the wire.
	if info.currentModel != "deepseek-v4.1-flash" {
		t.Fatalf("current = %q", info.currentModel)
	}
	if info.models[0].Name != "deepseek-v4-pro" || info.models[1].Name != "deepseek-v4.1-flash" {
		t.Fatalf("catalog ids = %q, %q", info.models[0].Name, info.models[1].Name)
	}
	if info.configValues["deepseek-v4.1-flash"] != `["codegoai-deepseek","deepseek-v4.1-flash"]` {
		t.Fatalf("wire value lost: %+v", info.configValues)
	}
	if info.models[0].Alias != "DeepSeek DeepSeek-V4-Pro" {
		t.Fatalf("alias should carry group + name for matching/display: %q", info.models[0].Alias)
	}
	if info.effortConfig != "" {
		t.Fatalf("deepseek has no effort option: %+v", info)
	}
}

func TestParseModelInfoSameModelTwoProviders(t *testing.T) {
	info := parseResult(t, `{"configOptions":[{"id":"model","category":"model","currentValue":"[\"a\",\"m\"]",
	 "options":[{"group":"a","name":"A","options":[{"value":"[\"a\",\"m\"]","name":"M"}]},
	            {"group":"b","name":"B","options":[{"value":"[\"b\",\"m\"]","name":"M"}]}]}]}`)
	if len(info.models) != 2 {
		t.Fatalf("models: %+v", info)
	}
	if info.models[0].Name != "a/m" || info.models[1].Name != "b/m" || info.currentModel != "a/m" {
		t.Fatalf("ids must stay distinct: %+v current %q", info.models, info.currentModel)
	}
}

func TestParseModelInfoCursorPrefersSetModel(t *testing.T) {
	info := parseResult(t, `{"models":{"currentModelId":"composer-2.5[fast=true]","availableModels":[{"modelId":"composer-2.5[fast=true]","name":"composer-2.5"}]},
	 "configOptions":[{"id":"mode","options":[{"value":"agent"}]},{"id":"model","options":[{"value":"composer-2.5[fast=true]"}]}]}`)
	if !info.viaSetModel || info.viaConfig || len(info.models) != 1 {
		t.Fatalf("cursor: %+v", info)
	}
}

// #2071: `model list` shows core.ModelStatus, which only passes through GetModel and
// AvailableModels. DSH advertises a ["provider","model"] route; both fields must be model ids.
func TestModelStatusReportsDSHModelIDs(t *testing.T) {
	info := parseResult(t, `{"configOptions":[{"id":"model","category":"model",
	 "currentValue":"[\"deepseek-official\",\"deepseek-v4.1-flash\"]",
	 "options":[{"group":"DeepSeek","name":"DeepSeek","options":[
	   {"value":"[\"deepseek-official\",\"deepseek-v4.1-flash\"]","name":"DeepSeek V4.1 Flash"}]}]}]}`)
	a := &Agent{}
	a.reportModelInfo(info)
	e := core.NewEngine("test", a, nil, "", core.LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })

	st := e.ModelStatus(context.Background(), "test:ds")
	if st.Model != "deepseek-v4.1-flash" {
		t.Fatalf("ModelStatus.Model = %q", st.Model)
	}
	if len(st.Models) != 1 || st.Models[0].Name != "deepseek-v4.1-flash" {
		t.Fatalf("ModelStatus.Models = %+v", st.Models)
	}
	if raw, err := json.Marshal(st); err == nil {
		t.Logf("model list --json: %s", raw)
	}
}

func TestModelStatusKeepsSingleValueModels(t *testing.T) {
	info := parseResult(t, `{"models":{"currentModelId":"grok-4.7","availableModels":[
	 {"modelId":"grok-4.7","name":"grok-4.7"},{"modelId":"codegoai-grok","name":"codegoai-grok"}]}}`)
	a := &Agent{}
	a.reportModelInfo(info)
	e := core.NewEngine("test", a, nil, "", core.LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })

	st := e.ModelStatus(context.Background(), "test:grok")
	if st.Model != "grok-4.7" || len(st.Models) != 2 ||
		st.Models[0].Name != "grok-4.7" || st.Models[1].Name != "codegoai-grok" {
		t.Fatalf("single-value list changed: model=%q models=%+v", st.Model, st.Models)
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
