package core

// The DSH route's last two wizard steps (user, 2026-10-23: 「看看能不能有我们discord类似的体验」):
// configure writes the model key into DSH's own credential store, turns off DSH's sign-in prompt
// and leaves the chosen roles for the collab plugin to add to #general; open starts `dsh web` in
// the background and hands back the link, so nobody has to open a terminal.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// DSHMember is one role the wizard adds to the DSH channels (collab dsh/collab/roster.mjs fields).
type DSHMember struct {
	Name    string `json:"name"`
	CLI     string `json:"cli,omitempty"` // claude | codex | gemini (collab roster.mjs CLIS); empty = DSH model
	Persona string `json:"persona,omitempty"`
	Avatar  string `json:"avatar,omitempty"`
}

// DSHConfigureRequest is the body of POST /setup/dsh/configure.
type DSHConfigureRequest struct {
	DeepSeekAPIKey string      `json:"deepseek_api_key,omitempty"`
	Members        []DSHMember `json:"members"`
}

// DSHConfigureResult says what was written (never the key itself).
type DSHConfigureResult struct {
	KeySaved    bool   `json:"key_saved"`
	MembersFile string `json:"members_file"`
	Members     int    `json:"members"`
}

// dshCLIs are the local CLIs a collab member may run as (dsh/collab/roster.mjs CLIS).
var dshCLIs = map[string]bool{"claude": true, "codex": true, "gemini": true}

var dshMemberName = regexp.MustCompile(`^[^\s@<>]{1,32}$`) // collab roster.mjs validate(): 1-32, no spaces, @ or <>

// collabDataDir mirrors dsh/collab/cordis.patch.yml: $CONEST_COLLAB_DATA, else ~/.conest-collab.
func collabDataDir() string {
	if d := os.Getenv("CONEST_COLLAB_DATA"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".conest-collab")
}

// ConfigureDSH saves the key, disables the sign-in prompt and writes the roles for the plugin.
func ConfigureDSH(req DSHConfigureRequest) (DSHConfigureResult, error) {
	var res DSHConfigureResult
	seen := map[string]bool{}
	for i, m := range req.Members {
		m.Name = strings.TrimSpace(m.Name)
		if !dshMemberName.MatchString(m.Name) {
			return res, fmt.Errorf("角色名「%s」不能为空、不能超过 32 个字，也不能有空格、@ 或 <>", m.Name)
		}
		if seen[strings.ToLower(m.Name)] {
			return res, fmt.Errorf("角色名「%s」重复了", m.Name)
		}
		seen[strings.ToLower(m.Name)] = true
		if m.CLI != "" && !dshCLIs[m.CLI] {
			return res, fmt.Errorf("unsupported cli %q", m.CLI)
		}
		if m.CLI == "" && strings.TrimSpace(req.DeepSeekAPIKey) == "" && !dshHasDeepSeekKey() {
			return res, fmt.Errorf("角色「%s」没选本机 CLI，也没有 DeepSeek API Key：选一个 CLI，或填 Key", m.Name)
		}
		req.Members[i] = m
	}
	if k := strings.TrimSpace(req.DeepSeekAPIKey); k != "" {
		if err := writeDSHCredential(filepath.Join(dshHome(), ".credentials.yaml"), "DEEPSEEK_API_KEY", k); err != nil {
			return res, fmt.Errorf("save key: %w", err)
		}
		res.KeySaved = true
	}
	patch := filepath.Join(dshHome(), "profiles", DSHProfile, "cordis.patch.yml")
	if err := setDSHPatchConfig(patch, "ui-settings-models", "credentialOnboarding", false); err != nil {
		return res, fmt.Errorf("profile patch: %w", err)
	}
	dir := collabDataDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return res, err
	}
	res.MembersFile = filepath.Join(dir, "wizard-members.json")
	b, _ := json.MarshalIndent(map[string]any{"members": req.Members}, "", "  ")
	if err := os.WriteFile(res.MembersFile, b, 0o600); err != nil {
		return res, err
	}
	res.Members = len(req.Members)
	// A dsh web we started earlier read the old patch and members at boot; the next open restarts it.
	if b, err := os.ReadFile(dshWebStatePath()); err == nil {
		var prev DSHWeb
		if json.Unmarshal(b, &prev) == nil && prev.PID > 0 && processAlive(prev.PID) {
			stopProcess(prev.PID)
		}
		_ = os.Remove(dshWebStatePath())
	}
	return res, nil
}

// dshHasDeepSeekKey: a DeepSeek key is already stored or exported (dsh-credentials-local precedence).
func dshHasDeepSeekKey() bool {
	if os.Getenv("DEEPSEEK_API_KEY") != "" {
		return true
	}
	b, err := os.ReadFile(filepath.Join(dshHome(), ".credentials.yaml"))
	if err != nil {
		return false
	}
	var doc struct {
		Refs map[string]string `yaml:"refs"`
	}
	return yaml.Unmarshal(b, &doc) == nil && doc.Refs["DEEPSEEK_API_KEY"] != ""
}

// writeDSHCredential sets refs.<name> in the dsh-credentials-local file (version: 1 document,
// see that package's README), keeping every other entry and comment; the file stays 0600.
func writeDSHCredential(path, name, value string) error {
	var doc yaml.Node
	if b, err := os.ReadFile(path); err == nil && strings.TrimSpace(string(b)) != "" {
		if err := yaml.Unmarshal(b, &doc); err != nil {
			return err
		}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if doc.Kind == 0 {
		doc = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode}}}
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return errors.New(path + ": root is not a mapping")
	}
	if mapGet(root, "version") == nil {
		mapSet(root, "version", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: "1"})
	}
	refs := mapGet(root, "refs")
	if refs == nil || refs.Kind != yaml.MappingNode {
		refs = &yaml.Node{Kind: yaml.MappingNode}
		mapSet(root, "refs", refs)
	}
	mapSet(refs, name, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value})
	return writeYAML(path, &doc, 0o600)
}

// setDSHPatchConfig sets config.<key> on the `- id: <id>` override entry of a profile's
// cordis.patch.yml (a top-level list; install.sh writes the `locale` entry the same way).
func setDSHPatchConfig(path, id, key string, value bool) error {
	var doc yaml.Node
	b, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if strings.TrimSpace(string(b)) != "" {
		if err := yaml.Unmarshal(b, &doc); err != nil {
			return err
		}
	}
	if doc.Kind == 0 || len(doc.Content) == 0 {
		doc = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.SequenceNode}}}
	}
	seq := doc.Content[0]
	if seq.Kind != yaml.SequenceNode {
		return errors.New(path + ": not a patch list")
	}
	seq.Style = 0
	var entry *yaml.Node
	for _, it := range seq.Content {
		if it.Kind == yaml.MappingNode && mapGet(it, "insert") == nil {
			if v := mapGet(it, "id"); v != nil && v.Value == id {
				entry = it
			}
		}
	}
	if entry == nil {
		entry = &yaml.Node{Kind: yaml.MappingNode}
		mapSet(entry, "id", &yaml.Node{Kind: yaml.ScalarNode, Value: id})
		seq.Content = append(seq.Content, entry)
	}
	cfg := mapGet(entry, "config")
	if cfg == nil || cfg.Kind != yaml.MappingNode {
		cfg = &yaml.Node{Kind: yaml.MappingNode}
		mapSet(entry, "config", cfg)
	}
	mapSet(cfg, key, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: fmt.Sprint(value)})
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeYAML(path, &doc, 0o644)
}

func mapGet(m *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

func mapSet(m *yaml.Node, key string, v *yaml.Node) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content[i+1] = v
			return
		}
	}
	m.Content = append(m.Content, &yaml.Node{Kind: yaml.ScalarNode, Value: key}, v)
}

func writeYAML(path string, doc *yaml.Node, mode os.FileMode) error {
	out, err := yaml.Marshal(doc)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, out, mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ── dsh web in the background ──────────────────────────────────

// DSHWeb is what POST /setup/dsh/open returns.
type DSHWeb struct {
	URL string `json:"url"` // channels page, token included
	PID int    `json:"pid"`
	Log string `json:"log"`
}

// dshChannelsHash opens the channels panel on load (dsh/packages/client-ui-discord deep link).
const dshChannelsHash = "#channels"

// dshWebStartTimeout: how long to wait for `dsh web` to print its address. No measurement; the
// walkthrough (2026-10-23, /tmp/dshux) saw it print within seconds, this leaves wide margin.
const dshWebStartTimeout = 60 * time.Second

var (
	dshWebMu  sync.Mutex
	dshWebURL = regexp.MustCompile(`dsh web: (https?://\S+)`)
)

func dshWebStatePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bothouse", "dsh-web.json")
}

// OpenDSHWeb returns the running `dsh web` we started earlier, or starts a new one detached from
// this process (it keeps running after the wizard exits) on a free port and waits for its link.
func OpenDSHWeb(ctx context.Context) (DSHWeb, error) {
	dshWebMu.Lock()
	defer dshWebMu.Unlock()
	statePath := dshWebStatePath()
	var prev DSHWeb
	if b, err := os.ReadFile(statePath); err == nil && json.Unmarshal(b, &prev) == nil && prev.PID > 0 && processAlive(prev.PID) && prev.URL != "" {
		return prev, nil
	}
	bin, err := LookDSH()
	if err != nil {
		return DSHWeb{}, errDSHMissing
	}
	logPath := filepath.Join(filepath.Dir(statePath), "dsh-web.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return DSHWeb{}, err
	}
	logf, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return DSHWeb{}, err
	}
	defer logf.Close()
	cmd := exec.Command(bin, "--profile", DSHProfile, "--no-open", "--port", "0")
	dataDir := os.Getenv("BOTHOUSE_DATA_DIR")
	if dataDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dataDir = filepath.Join(home, ".bothouse")
		}
	}
	if dataDir != "" {
		cmd.Env = append(os.Environ(), "BOTHOUSE_DATA_DIR="+dataDir, "CONEST_LEAD_FILE="+filepath.Join(dataDir, "lead.json"), "CONEST_COLLAB_DATA="+filepath.Join(dataDir, "dsh", "collab"))
	}
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.Stdin = nil
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home // the collab workspace defaults to dsh's cwd (dsh/collab/cordis.patch.yml)
	}
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return DSHWeb{}, err
	}
	pid := cmd.Process.Pid
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	deadline := time.NewTimer(dshWebStartTimeout)
	defer deadline.Stop()
	// Re-read the log until the address line shows up (interaction delay, no data behind it).
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		if u := scanDSHWebURL(logPath); u != "" {
			web := DSHWeb{URL: u + dshChannelsHash, PID: pid, Log: logPath}
			b, _ := json.Marshal(web)
			_ = os.WriteFile(statePath, b, 0o600)
			return web, nil
		}
		select {
		case <-ctx.Done():
			return DSHWeb{}, ctx.Err()
		case <-exited:
			return DSHWeb{}, fmt.Errorf("dsh web exited before printing its address:\n%s", tailFile(logPath, 2000))
		case <-deadline.C:
			return DSHWeb{}, fmt.Errorf("dsh web did not print its address in %s:\n%s", dshWebStartTimeout, tailFile(logPath, 2000))
		case <-tick.C:
		}
	}
}

func scanDSHWebURL(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if m := dshWebURL.FindStringSubmatch(sc.Text()); m != nil {
			return m[1]
		}
	}
	return ""
}

// ── HTTP ──────────────────────────────────────────────────────

func (m *ManagementServer) handleSetupDSHConfigure(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req DSHConfigureRequest
	if !decodeBody(w, r, &req) {
		return
	}
	res, err := ConfigureDSH(req)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, res)
}

func (m *ManagementServer) handleSetupDSHOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	web, err := OpenDSHWeb(r.Context())
	if err != nil {
		mgmtError(w, http.StatusBadGateway, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, web)
}
