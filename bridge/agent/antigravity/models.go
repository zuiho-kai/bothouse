package antigravity

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

const cliModelCatalogTTL = time.Minute

type cliModelCatalog struct {
	key       [sha256.Size]byte
	models    []core.ModelOption
	expiresAt time.Time
}

// Discover models from the same CLI/account as chat. The public Gemini API
// and a static list cannot describe Antigravity's available model IDs.
func (a *Agent) fetchModelsFromCLI(ctx context.Context) []core.ModelOption {
	if ctx.Err() != nil {
		return nil
	}
	a.mu.RLock()
	binary := a.cmd
	args := append([]string(nil), a.cliExtraArgs...)
	workDir := a.workDir
	env := append([]string(nil), a.configEnv...)
	env = append(env, a.providerEnvLocked()...)
	env = append(env, a.sessionEnv...)
	provider := a.activeIdx
	a.mu.RUnlock()
	if binary == "" {
		binary = "agy"
	}
	env = core.MergeEnv(os.Environ(), env)
	// Keep one short-lived successful catalog for list -> set. Include the
	// effective command, directory, provider and environment so another account
	// or session cannot reuse it. Hash rather than retain credential values.
	effectiveEnv := make(map[string]string, len(env))
	for _, entry := range env {
		if name, value, ok := strings.Cut(entry, "="); ok {
			effectiveEnv[name] = value
		}
	}
	identity, _ := json.Marshal([]any{binary, args, workDir, provider, effectiveEnv})
	key := sha256.Sum256(identity)
	a.mu.RLock()
	cached := a.modelCatalog
	if cached.key == key && time.Now().Before(cached.expiresAt) {
		models := append([]core.ModelOption(nil), cached.models...)
		a.mu.RUnlock()
		return models
	}
	a.mu.RUnlock()

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, append(args, "models")...)
	cmd.Dir = workDir
	cmd.Env = env
	cmd.WaitDelay = time.Second
	started := time.Now()
	output, err := cmd.Output()
	if err != nil {
		// Do not log CLI output: a failed CLI may include account details.
		slog.Warn("antigravity: native model discovery failed", "error", err, "context_error", ctx.Err(), "elapsed", time.Since(started))
		return nil
	}
	models := parseCLIModels(string(output))
	if len(models) == 0 {
		slog.Warn("antigravity: native model discovery returned no model rows")
		return nil
	}
	a.mu.Lock()
	a.modelCatalog = cliModelCatalog{key: key, models: append([]core.ModelOption(nil), models...), expiresAt: time.Now().Add(cliModelCatalogTTL)}
	a.mu.Unlock()
	return models
}

// agy models emits tab-separated ID/description rows. Keep the advertised IDs
// verbatim, including effort suffixes and models from other vendors.
func parseCLIModels(output string) []core.ModelOption {
	var models []core.ModelOption
	seen := make(map[string]bool)
	for _, line := range strings.Split(output, "\n") {
		id, desc, ok := strings.Cut(strings.TrimSpace(line), "\t")
		id, desc = strings.TrimSpace(id), strings.TrimSpace(desc)
		if !ok || id == "" || desc == "" || seen[id] || !validModelID(id) {
			continue
		}
		seen[id] = true
		models = append(models, core.ModelOption{Name: id, Desc: desc})
	}
	return models
}

func validModelID(id string) bool {
	for _, c := range id {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-_.:/@", c) {
			continue
		}
		return false
	}
	return true
}
