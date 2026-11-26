package core

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type cachedModels struct {
	models []ModelOption
	at     time.Time
}

var (
	modelCacheMu sync.Mutex
	modelCache   = map[string]cachedModels{}
)

const modelCacheTTL = 60 * time.Second

func getCachedModels(key string, forceRefresh bool) ([]ModelOption, bool) {
	if forceRefresh {
		return nil, false
	}
	modelCacheMu.Lock()
	defer modelCacheMu.Unlock()
	if c, ok := modelCache[key]; ok && time.Since(c.at) < modelCacheTTL && len(c.models) > 0 {
		out := make([]ModelOption, len(c.models))
		copy(out, c.models)
		return out, true
	}
	return nil, false
}

func setCachedModels(key string, models []ModelOption) {
	if len(models) == 0 {
		return
	}
	modelCacheMu.Lock()
	defer modelCacheMu.Unlock()
	cp := make([]ModelOption, len(models))
	copy(cp, models)
	modelCache[key] = cachedModels{models: cp, at: time.Now()}
}

// ParseDuccModelsOutput parses `ducc models` output:
//
//	Available Models:
//	auto-内部, ..., Claude Sonnet 5.5, gpt-6.2-sol, ...
func ParseDuccModelsOutput(raw string) []ModelOption {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if idx := strings.Index(raw, "Available Models:"); idx >= 0 {
		raw = raw[idx+len("Available Models:"):]
	}
	raw = strings.ReplaceAll(raw, "\r", "\n")
	seen := map[string]bool{}
	var out []ModelOption
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Tips") || strings.HasPrefix(line, "Error") {
			continue
		}
		for _, part := range strings.Split(line, ",") {
			name := strings.TrimSpace(part)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			out = append(out, ModelOption{Name: name})
		}
	}
	return out
}

// ParseZuluModelsJSON parses `zulu list-model` JSON output.
// `zulu run -m` recommends displayName ("支持ID和显示名，推荐显示名"), so Name prefers displayName.
func ParseZuluModelsJSON(raw []byte) []ModelOption {
	trimmed := strings.TrimSpace(string(raw))
	start := strings.IndexByte(trimmed, '[')
	end := strings.LastIndexByte(trimmed, ']')
	if start < 0 || end <= start {
		return nil
	}
	var items []struct {
		ModelID     string `json:"modelId"`
		DisplayName string `json:"displayName"`
		ModelType   string `json:"modelType"`
	}
	if err := json.Unmarshal([]byte(trimmed[start:end+1]), &items); err != nil {
		return nil
	}
	seen := map[string]bool{}
	out := make([]ModelOption, 0, len(items))
	for _, m := range items {
		name := strings.TrimSpace(m.DisplayName)
		if name == "" {
			name = strings.TrimSpace(m.ModelType)
		}
		if name == "" {
			name = strings.TrimSpace(m.ModelID)
		}
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		desc := strings.TrimSpace(m.ModelType)
		if desc == name {
			desc = ""
		}
		out = append(out, ModelOption{Name: name, Desc: desc})
	}
	return out
}

// FetchDuccModels runs `<cmdPath> models` to get the live model list from ducc.
func FetchDuccModels(ctx context.Context, cmdPath string, forceRefresh bool) []ModelOption {
	if cmdPath == "" {
		cmdPath = "ducc"
	}
	cacheKey := "ducc:" + cmdPath
	if cached, ok := getCachedModels(cacheKey, forceRefresh); ok {
		return cached
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(qctx, cmdPath, "models").Output()
	if err != nil {
		return nil
	}
	models := ParseDuccModelsOutput(string(out))
	setCachedModels(cacheKey, models)
	return models
}

// FetchRemoteDuccModels runs remote `ducc models` over SSH (direct or relay).
func FetchRemoteDuccModels(ctx context.Context, cmdPath, remoteHost, relayHost string, sshArgs []string, forceRefresh bool) []ModelOption {
	remoteHost = strings.TrimSpace(remoteHost)
	relayHost = strings.TrimSpace(relayHost)
	if remoteHost == "" {
		return FetchDuccModels(ctx, cmdPath, forceRefresh)
	}
	cacheKey := "ducc-remote:" + cmdPath + "|" + remoteHost + "|" + relayHost
	if cached, ok := getCachedModels(cacheKey, forceRefresh); ok {
		return cached
	}
	qctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	script := BuildRemoteDuccScript(cmdPath, "", []string{"models"}, "", nil)
	out, _, err := RunRemoteScript(qctx, SSHExecConfig{
		RemoteHost: remoteHost,
		RelayHost:  relayHost,
		SSHArgs:    sshArgs,
	}, script)
	if err != nil {
		return nil
	}
	models := ParseDuccModelsOutput(string(out))
	setCachedModels(cacheKey, models)
	return models
}

// FetchZuluModels runs `zulu list-model` (locally or on a remote Linux host via direct/relay SSH).
func FetchZuluModels(ctx context.Context, cmdPath, remoteHost, relayHost string, sshArgs []string, username string, forceRefresh bool) []ModelOption {
	remoteHost = strings.TrimSpace(remoteHost)
	relayHost = strings.TrimSpace(relayHost)
	cacheKey := "zulu:" + cmdPath + "|" + remoteHost + "|" + relayHost + "|" + username
	if cached, ok := getCachedModels(cacheKey, forceRefresh); ok {
		return cached
	}

	qctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var out []byte
	var err error
	if remoteHost != "" {
		script := BuildRemoteZuluScript(cmdPath, []string{"list-model"}, username)
		out, _, err = RunRemoteScript(qctx, SSHExecConfig{
			RemoteHost: remoteHost,
			RelayHost:  relayHost,
			SSHArgs:    sshArgs,
		}, script)
	} else {
		if cmdPath == "" {
			cmdPath = "zulu"
		}
		if username == "" {
			username = DetectComateUsername()
		}
		args := []string{"list-model"}
		if username != "" {
			args = append(args, "--username", username)
		}
		out, err = exec.CommandContext(qctx, cmdPath, args...).Output()
	}
	if err != nil {
		return nil
	}
	models := ParseZuluModelsJSON(out)
	setCachedModels(cacheKey, models)
	return models
}

type modelOptionJSON struct {
	Name  string `json:"name"`
	Desc  string `json:"desc,omitempty"`
	Alias string `json:"alias,omitempty"`
}

func encodeModelOptions(models []ModelOption) []modelOptionJSON {
	out := make([]modelOptionJSON, len(models))
	for i, m := range models {
		out[i] = modelOptionJSON{
			Name:  m.Name,
			Desc:  m.Desc,
			Alias: m.Alias,
		}
	}
	return out
}

// handleSetupModels serves GET /api/v1/setup/models?agent_type=claudecode|zulu&remote_host=...&relay_host=...&ssh_args=...&refresh=1
// so SetupWizard and ProjectWizard can present live model lists fetched from ducc or iDev Zulu.
func (m *ManagementServer) handleSetupModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	q := r.URL.Query()
	agentType := strings.TrimSpace(q.Get("agent_type"))
	remoteHost := strings.TrimSpace(q.Get("remote_host"))
	relayHost := strings.TrimSpace(q.Get("relay_host"))
	refresh := q.Get("refresh") == "1" || strings.EqualFold(q.Get("refresh"), "true")
	var sshArgs []string
	if raw := strings.TrimSpace(q.Get("ssh_args")); raw != "" {
		sshArgs = strings.Fields(raw)
	}

	clis := DetectLocalCLIs(r.Context())
	findBin := func(at string) string {
		for _, c := range clis {
			if c.AgentType == at && c.Supported && c.Path != "" {
				return c.Path
			}
		}
		return ""
	}

	var models []ModelOption
	source := "default"

	switch agentType {
	case "claudecode":
		if remoteHost != "" {
			if ms := FetchRemoteDuccModels(r.Context(), "ducc", remoteHost, relayHost, sshArgs, refresh); len(ms) > 0 {
				models = ms
				source = "ducc-remote"
			}
		} else {
			bin := findBin("claudecode")
			if bin != "" && filepath.Base(bin) == "ducc" {
				if ms := FetchDuccModels(r.Context(), bin, refresh); len(ms) > 0 {
					models = ms
					source = "ducc"
				}
			}
		}
		if len(models) == 0 {
			models = []ModelOption{
				{Name: "sonnet", Desc: "Claude Sonnet (balanced)"},
				{Name: "opus", Desc: "Claude Opus (most capable)"},
				{Name: "haiku", Desc: "Claude Haiku (fastest)"},
			}
		}
	case "zulu":
		bin := ""
		if remoteHost == "" {
			bin = findBin("zulu")
			if bin == "" {
				bin = "/Applications/iDev.app/Contents/Resources/app/extensions/baiducomate.comate/dist/zulu-cli/bin/zulu"
			}
		}
		if ms := FetchZuluModels(r.Context(), bin, remoteHost, relayHost, sshArgs, "", refresh); len(ms) > 0 {
			models = ms
			if remoteHost != "" {
				source = "zulu-remote"
			} else {
				source = "zulu"
			}
		}
		if len(models) == 0 {
			models = []ModelOption{{Name: "Auto", Desc: "Zulu default model"}}
		}
	}

	if models == nil {
		models = []ModelOption{}
	}
	names := make([]string, len(models))
	for i, opt := range models {
		names[i] = opt.Name
	}
	mgmtJSON(w, http.StatusOK, map[string]any{
		"models":  names,
		"options": encodeModelOptions(models),
		"source":  source,
	})
}
