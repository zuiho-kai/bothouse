package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// #2113: a relay (new-api, one-api …) only knows model IDs such as claude-opus-4-7. A user who
// typed the name they see in a model menu ("Opus 4.7") into the wizard got it written as the
// model, every turn then failed with 503 model_not_found. Model IDs never contain whitespace, so a
// model with a space is a display name; ResolveModelID turns it into the relay's ID.
//
// Every place that writes a model for a third-party API goes through here: the setup wizard
// (ApplyWizard), the management page's providers, and the start of a project for configs written
// before this check (cmd FixDisplayNameModels).

// LooksLikeDisplayName: model IDs have no whitespace; "Opus 4.7", "GPT 5.6 Terra" do.
func LooksLikeDisplayName(model string) bool {
	return strings.ContainsAny(strings.TrimSpace(model), " \t")
}

// modelsURL: <base>/models for an OpenAI-style base ending in /v1, else <base>/v1/models
// (Anthropic-style bases such as https://relay or https://api.deepseek.com/anthropic).
func modelsURL(baseURL string) string {
	b := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(b, "/v1") {
		return b + "/models"
	}
	return b + "/v1/models"
}

// FetchModelIDs asks the endpoint for its model list (GET /v1/models — the OpenAI and Anthropic
// list call; new-api answers both headers). It returns the IDs as the endpoint spells them.
func FetchModelIDs(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, fmt.Errorf("no base_url")
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL(baseURL), nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("x-api-key", apiKey)
	}
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: HTTP %d", modelsURL(baseURL), resp.StatusCode)
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct { // Ollama-style /api/tags shape some local servers also return
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("model list: %w", err)
	}
	seen := map[string]bool{}
	var ids []string
	add := func(id string) {
		if id = strings.TrimSpace(id); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, m := range body.Data {
		add(m.ID)
	}
	for _, m := range body.Models {
		add(m.Name)
	}
	sort.Strings(ids)
	return ids, nil
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func modelKey(s string) string {
	return strings.Trim(nonAlnum.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

// MatchModelID finds the ID a model name means: the same ID (any case), else the IDs whose
// words contain the name's words ("Opus 4.7" → opus-4-7 → claude-opus-4-7); the shortest such ID
// wins (claude-opus-4-7 over claude-opus-4-7-thinking). ok is false when nothing matches or two
// equally short IDs do.
func MatchModelID(ids []string, model string) (string, bool) {
	model = strings.TrimSpace(model)
	for _, id := range ids {
		if strings.EqualFold(id, model) {
			return id, true
		}
	}
	k := modelKey(model)
	if k == "" {
		return "", false
	}
	var best []string
	for _, id := range ids {
		ik := modelKey(id)
		if ik == k || strings.HasPrefix(ik, k+"-") || strings.HasSuffix(ik, "-"+k) || strings.Contains(ik, "-"+k+"-") {
			switch {
			case len(best) == 0 || len(id) < len(best[0]):
				best = []string{id}
			case len(id) == len(best[0]):
				best = append(best, id)
			}
		}
	}
	if len(best) != 1 {
		return "", false
	}
	return best[0], true
}

// ResolveModelID returns the model ID to write for model on this endpoint.
//   - an ID the endpoint lists, or any name without spaces when the list is unavailable: unchanged
//     (some relays leave models out of the list; only a display name is certainly wrong);
//   - a display name: the matching ID from the endpoint's list;
//   - a display name with no single match: an error naming the IDs to choose from.
func ResolveModelID(ctx context.Context, baseURL, apiKey, model string) (string, error) {
	model = strings.TrimSpace(model)
	if model == "" || !LooksLikeDisplayName(model) {
		return model, nil
	}
	ids, err := FetchModelIDs(ctx, baseURL, apiKey)
	if err != nil {
		return "", fmt.Errorf("模型 %q 是显示名，不是模型 ID（ID 里没有空格，比如 claude-opus-4-7）；去中转站取模型列表也失败了：%v。请填中转站后台「模型」里那一列 ID", model, err)
	}
	if id, ok := MatchModelID(ids, model); ok {
		return id, nil
	}
	return "", fmt.Errorf("模型 %q 是显示名，不是模型 ID；这个中转站可用的 ID：%s", model, shortList(ids, 12))
}

func shortList(ids []string, n int) string {
	if len(ids) == 0 {
		return "（列表为空）"
	}
	if len(ids) <= n {
		return strings.Join(ids, ", ")
	}
	return strings.Join(ids[:n], ", ") + fmt.Sprintf(" …（共 %d 个）", len(ids))
}

// wizardListBase: the OpenAI-style base the wizard's model list is read from — what the user typed,
// else the vendor's own.
func wizardListBase(p WizardProvider) string {
	if b := strings.TrimSpace(p.BaseURL); b != "" {
		return b
	}
	v, _ := wizardVendor(p.Vendor)
	return v.OpenAIBase
}

// WizardProviderModels: the IDs the wizard offers in its model box (/setup/provider/models).
func WizardProviderModels(ctx context.Context, p WizardProvider) ([]string, error) {
	return FetchModelIDs(ctx, wizardListBase(p), p.APIKey)
}
