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
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
	"gopkg.in/yaml.v3"
)

// DSHMember is one role the wizard adds to the DSH channels (collab dsh/collab/roster.mjs fields).
type DSHMember struct {
	Name           string `json:"name"`
	CLI            string `json:"cli,omitempty"` // claude | codex | gemini (collab roster.mjs CLIS); empty = DSH model
	Persona        string `json:"persona,omitempty"`
	Avatar         string `json:"avatar,omitempty"`
	NameCustomized *bool  `json:"name_customized,omitempty"`
	// Model pins a DSH-model role to the route the wizard's key belongs to (set by configure, not the page).
	Model *DSHMemberModel `json:"model,omitempty"`
}

// DSHMemberModel is a collab member's model route (roster.mjs validate: provider + model).
type DSHMemberModel struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

// dshKeyModel is the route the wizard's DeepSeek key serves: DSH's API-key adapter
// (@deepseek-ai/dsh-llm-deepseek-api-key, provider deepseek-official, key DEEPSEEK_API_KEY) and the model
// dsh-base sets as its default (agent-default-model, same in DeepSeek Harness Desktop 0.2.2-rc.1). Pinning it
// keeps the role answering with the key it was set up with even when the DSH default model is switched to a
// route without a key (for example a DeepSeek account sign-in in the desktop app): that showed 还没填模型密钥 (#1173).
var dshKeyModel = DSHMemberModel{Provider: "deepseek-official", Model: "deepseek-flash"}

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
var dshClaudeName = regexp.MustCompile(`^Claude Code(?:-\d+)?$`)

// validDSHMemberName mirrors the DSH roster's exception for the automatic
// Claude Code name; ordinary names still may not contain spaces.
func validDSHMemberName(name string) bool {
	if dshClaudeName.MatchString(name) {
		return len(name) <= 32
	}
	return dshMemberName.MatchString(name)
}

// collabDataDir mirrors dsh/collab/cordis.patch.yml: $CONEST_COLLAB_DATA, else ~/.conest-collab.
func collabDataDir() string {
	if d := os.Getenv("CONEST_COLLAB_DATA"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".conest-collab")
}

// dshMembersFile: what ConfigureDSH writes for the collab plugin (dsh/collab/roster.mjs reads it).
func dshMembersFile() string { return filepath.Join(collabDataDir(), "wizard-members.json") }

// DSHRouteConfigured: the wizard has set up DSH-native members on this machine. They take their
// per-turn wiki pages and task board from the local gate, so bothouse runs the gate for them.
func DSHRouteConfigured() bool {
	for _, f := range []string{dshMembersFile(), dshImportedFile()} { // the plugin renames it on import
		if _, err := os.Stat(f); err == nil {
			return true
		}
	}
	return false
}

// ConfigureDSH saves the key, disables the sign-in prompt and writes the roles for the plugin.
func ConfigureDSH(req DSHConfigureRequest) (DSHConfigureResult, error) {
	var res DSHConfigureResult
	seen := map[string]bool{}
	for i, m := range req.Members {
		m.Name = strings.TrimSpace(m.Name)
		if !validDSHMemberName(m.Name) {
			return res, fmt.Errorf("角色名「%s」不能为空、不能超过 32 个字，也不能有空格（Claude Code 自动名除外）、@ 或 <>", m.Name)
		}
		if seen[strings.ToLower(m.Name)] {
			return res, fmt.Errorf("角色名「%s」重复了", m.Name)
		}
		seen[strings.ToLower(m.Name)] = true
		if m.CLI != "" && !dshCLIs[m.CLI] {
			return res, fmt.Errorf("unsupported cli %q", m.CLI)
		}
		if m.CLI == "" && strings.TrimSpace(req.DeepSeekAPIKey) == "" && !dshHasUsableModel() {
			return res, fmt.Errorf("角色「%s」没选本机 CLI，也没有 DeepSeek API Key：选一个 CLI，或填 Key", m.Name)
		}
		// Only an official API key selects this route; account and relay users keep their own default.
		if m.CLI == "" && (strings.TrimSpace(req.DeepSeekAPIKey) != "" || dshHasDeepSeekKey()) {
			mm := dshKeyModel
			m.Model = &mm
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
	if err := setDSHPatchConfig(patch, "attachment-local", "maxImageDimension", DSHMaxImageDimension); err != nil {
		return res, fmt.Errorf("profile patch: %w", err)
	}
	if err := setDSHDesktopPatchConfig(); err != nil {
		return res, fmt.Errorf("desktop profile patch: %w", err)
	}
	dir := collabDataDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return res, err
	}
	res.MembersFile = dshMembersFile()
	// The last run's imported roster is stale now: the wikis wait for the plugin to import this one.
	if err := os.Remove(dshImportedFile()); err != nil && !os.IsNotExist(err) {
		return res, fmt.Errorf("remove the old imported roles: %w", err)
	}
	b, _ := json.MarshalIndent(map[string]any{"members": req.Members}, "", "  ")
	if err := os.WriteFile(res.MembersFile, b, 0o600); err != nil {
		return res, err
	}
	res.Members = len(req.Members)
	// A dsh web we started earlier read the old patch and members at boot; the next open restarts it.
	stopDSHWebLaunch()
	if b, err := os.ReadFile(dshWebStatePath()); err == nil {
		var prev DSHWeb
		if json.Unmarshal(b, &prev) == nil && prev.PID > 0 && processAlive(prev.PID) && !isDSHDesktopHost(prev) {
			// Same rule as stopDSHWebForImport: the recorded pid may already be someone else's.
			if owned, why := dshWebPIDOwned(prev.PID); !owned {
				slog.Warn("dsh web: not stopping the pid the state file records: it is not this bridge's: "+why,
					"pid", prev.PID)
			} else {
				stopProcess(prev.PID)
			}
		}
		_ = os.Remove(dshWebStatePath())
	}
	return res, nil
}

// dshHasUsableModel shares CLI login detection and the existing model/key validation.
// A route declaration alone must not let a role without credentials through the wizard.
func dshHasUsableModel() bool {
	home, _ := os.UserHomeDir()
	if dshLogin(home) != "logged_in" {
		return false
	}
	_, err := dshModelSetup("en", "", dshHome(), nil)
	return err == nil
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

// setDSHPatchConfig sets config.<key> (a bool or int) on the `- id: <id>` override entry of a profile's
// cordis.patch.yml (a top-level list; install.sh writes the `locale` entry the same way); the entry's
// other keys stay.
func setDSHPatchConfig(path, id, key string, value any) error {
	var val *yaml.Node
	switch v := value.(type) {
	case bool:
		val = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: fmt.Sprint(v)}
	case int:
		val = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: fmt.Sprint(v)}
	default:
		return fmt.Errorf("unsupported patch value %T", value)
	}
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
	mapSet(cfg, key, val)
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
	return renameDSHYAML(tmp, path)
}

// ── dsh web in the background ──────────────────────────────────

// DSHWeb is what POST /setup/dsh/open returns.
type DSHWeb struct {
	URL string `json:"url"` // channels page, token included
	PID int    `json:"pid"`
	Log string `json:"log"`
	// Starting: dsh web is up but has not printed its address yet. There is no deadline: a Windows
	// first start took 2 min 31 s (sanxin-hk, v0.1.50, 2026-11-05), so the wizard keeps asking while
	// the process lives and shows how long it has waited and the last log line. Only an exit fails it.
	Starting   bool   `json:"starting,omitempty"`
	ElapsedSec int    `json:"elapsed_sec,omitempty"`
	LogTail    string `json:"log_tail,omitempty"`
}

// dshChannelsHash opens the channels panel on load (dsh/packages/client-ui-discord deep link).
const dshChannelsHash = "#channels"

// dshWebOpenWait: how long one open call waits for the address before it answers "still starting"
// (a macOS start prints it within this, so one call is enough there).
var dshWebOpenWait = 3 * time.Second

// dshWebLaunch is a `dsh web` we started that has not printed its address yet. It is kept in
// memory and in dsh-web.starting.json, so a second click, a second tab or a restarted bothouse
// claims it instead of starting another one.
type dshWebLaunch struct {
	PID     int       `json:"pid"`
	Log     string    `json:"log"`
	Offset  int64     `json:"offset,omitempty"` // the log's size when this launch started appending
	Started time.Time `json:"started"`
	exited  chan struct{}
}

var dshWebStarting *dshWebLaunch

func dshWebStartingPath() string {
	return filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-web.starting.json")
}

// currentDSHWebLaunch returns the launch still in progress, from memory or from the file a
// previous bothouse left; nil when there is none or its process is gone. Caller holds dshWebMu.
func currentDSHWebLaunch() *dshWebLaunch {
	if dshWebStarting != nil {
		return dshWebStarting
	}
	b, err := os.ReadFile(dshWebStartingPath())
	if err != nil {
		return nil
	}
	var l dshWebLaunch
	if json.Unmarshal(b, &l) != nil || l.PID <= 0 || !processAlive(l.PID) {
		_ = os.Remove(dshWebStartingPath())
		return nil
	}
	dshWebStarting = &l
	return dshWebStarting
}

func (l *dshWebLaunch) gone() bool {
	if l.exited != nil {
		select {
		case <-l.exited:
			return true
		default:
			return false
		}
	}
	return !processAlive(l.PID)
}

func dshWebLaunchInProgress() bool {
	dshWebMu.Lock()
	defer dshWebMu.Unlock()
	return currentDSHWebLaunch() != nil
}

func clearDSHWebLaunch() {
	dshWebStarting = nil
	_ = os.Remove(dshWebStartingPath())
}

// stopDSHWebLaunch ends a launch in progress (its boot read the old patch and roles).
func stopDSHWebLaunch() {
	dshWebMu.Lock()
	defer dshWebMu.Unlock()
	if l := currentDSHWebLaunch(); l != nil {
		stopProcess(l.PID)
		clearDSHWebLaunch()
	}
}

// waitDSHWebLaunch waits up to dshWebOpenWait for the address. It returns the ready web, or a
// Starting answer while the process lives, or an error once it has exited without an address.
func waitDSHWebLaunch(ctx context.Context, l *dshWebLaunch) (DSHWeb, error) {
	deadline := time.Now().Add(dshWebOpenWait)
	for {
		if u := lastDSHWebURLFrom(l.Log, l.Offset); u != "" {
			web := DSHWeb{URL: u + dshChannelsHash, PID: l.PID, Log: l.Log}
			b, _ := json.Marshal(web)
			_ = os.WriteFile(dshWebStatePath(), b, 0o600)
			clearDSHWebLaunch()
			slog.Info("dsh web: ready", "pid", l.PID, "took", time.Since(l.Started).Round(time.Second))
			return web, nil
		}
		if l.gone() {
			clearDSHWebLaunch()
			return DSHWeb{}, fmt.Errorf("dsh web exited before printing its address:\n%s", tailFile(l.Log, 2000))
		}
		if !time.Now().Before(deadline) {
			return DSHWeb{PID: l.PID, Log: l.Log, Starting: true,
				ElapsedSec: int(time.Since(l.Started).Seconds()), LogTail: lastLogLine(l.Log)}, nil
		}
		select {
		case <-ctx.Done():
			return DSHWeb{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// lastLogLine: the last non-empty line of the log (stack frames skipped), cut to 200 bytes.
func lastLogLine(path string) string {
	lines := strings.Split(strings.ReplaceAll(tailFile(path, 4000), "\r\n", "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		s := strings.TrimSpace(lines[i])
		if s == "" || strings.HasPrefix(s, "at ") {
			continue
		}
		if len(s) > 200 {
			s = s[:200]
		}
		return strings.ToValidUTF8(s, "")
	}
	return ""
}

// dshWikiImportWait: how long after the open step the member wikis wait for the plugin to import the roles.
const dshWikiImportWait = 2 * time.Minute

var (
	dshWebMu  sync.Mutex
	dshWebURL = regexp.MustCompile(`dsh web: (https?://\S+)`)
)

func dshWebStatePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bothouse", "dsh-web.json")
}

// OpenDSHWeb returns the running `dsh web` we started earlier, or starts a new one detached from
// this process (it keeps running after the wizard exits) on a free port. It answers Starting
// (call again) while that one has not printed its link yet; a launch in progress is claimed.
func OpenDSHWeb(ctx context.Context) (DSHWeb, error) {
	return openDSHWeb(ctx, "")
}

func openDSHWeb(ctx context.Context, configuredDataDir string) (DSHWeb, error) {
	dshWebMu.Lock()
	defer dshWebMu.Unlock()
	if l := currentDSHWebLaunch(); l != nil {
		return waitDSHWebLaunch(ctx, l)
	}
	statePath := dshWebStatePath()
	var prev DSHWeb
	if b, err := os.ReadFile(statePath); err == nil && json.Unmarshal(b, &prev) == nil && prev.PID > 0 && processAlive(prev.PID) && prev.URL != "" {
		// The collab plugin imports the wizard's roles only at boot: with roles still waiting, start it over.
		// The desktop app's host is the app's own (it reloads the roles itself): use it as it is.
		if _, err := os.Stat(dshMembersFile()); err != nil || isDSHDesktopHost(prev) {
			return prev, nil
		}
		if err := stopDSHWebForImport(prev.PID); err != nil {
			return DSHWeb{}, err
		}
	}
	logPath := filepath.Join(filepath.Dir(statePath), "dsh-web.log")
	// The same candidates the self-heal reads (dshWebLogPaths): a release update leaves the running
	// host's announcement in the recorded release log, while the default log keeps a previous
	// instance's token. Reading only the default one started a second `dsh web` into the instance
	// lock, or stopped the live launchd host first (#243 复核 D/D3/G3/G4).
	var recorded DSHWeb
	if b, err := os.ReadFile(statePath); err == nil {
		_ = json.Unmarshal(b, &recorded)
	}
	if web, ok, err := takeOverOrphanDSHWeb(dshWebLogPaths(recorded), prev.PID); err != nil {
		return DSHWeb{}, err
	} else if ok {
		return web, nil
	}
	bin, err := LookDSH()
	if err != nil {
		return DSHWeb{}, errDSHMissing
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return DSHWeb{}, err
	}
	// Append, never truncate: this log carries the announcement takeOverOrphanDSHWeb reads, and the
	// previous start's line is the only clue left when this one fails (a missing dsh, the plugin's
	// instance lock, an immediate crash). Wiping it is how a failed open lost the running host
	// (2026-11-05 现场, notes/dsh-bughunt2-B-185-bugs.md 第 3 条).
	offset := int64(0)
	if info, err := os.Stat(logPath); err == nil {
		offset = info.Size()
	}
	logf, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return DSHWeb{}, err
	}
	defer logf.Close()
	cmd := exec.Command(bin, "--profile", DSHProfile, "--no-open", "--port", "0")
	dataDir := strings.TrimSpace(configuredDataDir)
	if dataDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dataDir = ccconnect.DataDir(home) // same resolution as the bridge and contrib/gate/datadir.py
		}
	}
	if dataDir != "" {
		// GATE_PORT: where the collab plugin asks the gate for each turn's wiki pages and task board
		// (dsh/collab/gate-context.mjs), the port bothouse runs the gate on (gate_proc.go startLocked).
		env := []string{"BOTHOUSE_DATA_DIR=" + dataDir, "CONEST_LEAD_FILE=" + filepath.Join(dataDir, "lead.json"), "GATE_PORT=" + gatePort()}
		if fallback := dshFallbackLead(dataDir); fallback != "" {
			env = append(env, "CONEST_FALLBACK_LEAD="+fallback)
		}
		cmd.Env = append(os.Environ(), env...)
	}
	// Windows has no HOME, and the collab plugin's cordis.patch.yml up to v0.1.48 builds its data dir
	// from it ('undefined/.conest-collab': the plugin does not load, "频道未启用"). Upgrades keep that
	// file (keepIfExists), so hand dsh a HOME instead of relying on the new template alone.
	if os.Getenv("HOME") == "" {
		if home, err := os.UserHomeDir(); err == nil {
			if cmd.Env == nil {
				cmd.Env = os.Environ()
			}
			cmd.Env = append(cmd.Env, "HOME="+home)
		}
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
	l := &dshWebLaunch{PID: cmd.Process.Pid, Log: logPath, Offset: offset, Started: time.Now(), exited: make(chan struct{})}
	go func() { _ = cmd.Wait(); close(l.exited) }()
	dshWebStarting = l
	if b, err := json.Marshal(l); err == nil {
		_ = os.WriteFile(dshWebStartingPath(), b, 0o600)
	}
	slog.Info("dsh web: starting", "pid", l.PID)
	return waitDSHWebLaunch(ctx, l)
}

// dshWebStopWait: how long a running `dsh web` gets to exit before the wizard gives up on restarting it.
var dshWebStopWait = 10 * time.Second

// stopDSHWebForImport stops the `dsh web` at pid so a new one imports the waiting roles; it errs if it stays up.
//
// The pid is a hint, not proof: it comes from the state file, from lsof, or from an announcement, and
// any of those can outlive the host they named — macOS reuses pids within seconds, and an
// announcement is only as fresh as the log (#1255 阻塞二: this used to kill whatever carried the
// number). So the kill itself checks that the process still is a DSH host started for this bridge's
// data directory (dshWebPIDOwned); when it is not, nothing is signalled and the caller goes on to
// start its own host. Refusing costs a second instance; killing costs someone else's session.
func stopDSHWebForImport(pid int) error {
	if owned, why := dshWebPIDOwned(pid); !owned {
		slog.Warn("dsh web: not stopping this process, it is not this bridge's dsh web: "+why, "pid", pid)
		return nil
	}
	stopProcess(pid)
	for deadline := time.Now().Add(dshWebStopWait); processAlive(pid); time.Sleep(100 * time.Millisecond) {
		if time.Now().After(deadline) {
			return fmt.Errorf("新角色还没导入：正在运行的 dsh web（pid %d）没有退出，结束它后再打开一次", pid)
		}
	}
	_ = os.Remove(dshWebStatePath())
	return nil
}

func dshFallbackLead(dataDir string) string {
	b, err := os.ReadFile(filepath.Join(dataDir, gateTeamFile))
	if err != nil {
		return ""
	}
	var team struct {
		Lead struct {
			Aliases []string `json:"aliases"`
		} `json:"lead"`
	}
	if json.Unmarshal(b, &team) != nil {
		return ""
	}
	for _, alias := range team.Lead.Aliases {
		if regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`).MatchString(alias) {
			return alias
		}
	}
	return ""
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
	// before `dsh web` starts: it is given the gate port (GATE_PORT). A launch in progress already has it.
	if !dshWebLaunchInProgress() {
		if err := pickGatePortForDSH(m.wizardDataDir, m.wizardStore); err != nil {
			mgmtError(w, http.StatusInternalServerError, "gate port: "+err.Error())
			return
		}
	}
	// The gate does not need `dsh web` to be up: start it first, so a slow or failed start (a cold
	// Windows start took 2.5 min, 2026-11-05) does not leave the members without their gate until
	// bothouse restarts.
	EnsureGateForDSH(m.wizardDataDir)
	web, err := openDSHWeb(r.Context(), m.wizardDataDir)
	if err != nil {
		mgmtError(w, http.StatusBadGateway, err.Error())
		return
	}
	// the member ids exist once the plugin in `dsh web` has imported the roles: the wikis are named after them
	if !web.Starting {
		go makeDSHMemberWikisOnImport(m.wizardDataDir, dshWikiImportWait)
	}
	mgmtJSON(w, http.StatusOK, web)
}

// takeOverOrphanDSHWeb handles a `dsh web` this bridge started earlier but no longer tracks: its
// address is the last announcement in our own log, and something still listens on that port. An
// update restart is the usual way to get here (v0.1.48 → v0.1.50 on Windows, 2026-11-05: the old
// version's `dsh web` kept running, the state file had no pid, and every new start hung until the
// old one was killed by hand). When its launch token still signs in and no roles wait for import,
// adopt it (a cold start can take minutes on Windows); otherwise stop it so a fresh one can start.
//
// Each log in logPaths
// is tried in full and in order — its own announcement, its own token, its own port — and the first
// whose token signs in wins; a token is never tried against another log's port. When no log does,
// the address the state file recorded goes through the same gate (its token is the one the panel
// last used). Only after every candidate has failed may an untracked host on an announced loopback
// port be stopped: stopping on the first refusal killed the live launchd host whose announcement sat
// in a later log (#243 复核 G3/G4).
func takeOverOrphanDSHWeb(logPaths []string, trackedPID int) (DSHWeb, bool, error) {
	state, _, _ := readDSHWebState()
	// 来源：沿用 dshWebProbeTimeout——整轮（所有候选日志）共用一次探活时限，卡住的本地监听不会把
	// 打开拖过单次探活的上限（实测单次探活 0.5–3ms）。
	deadline := time.Now().Add(dshWebProbeTimeout)
	var refused *url.URL // the first announcement naming a loopback port whose host refused its token
	for _, logPath := range logPaths {
		if expired(deadline) {
			break // every candidate gets the same budget, not its own (#1255 阻塞三)
		}
		au, token, port, pid := orphanDSHWebPort(logPath, state, deadline)
		if au == nil {
			continue
		}
		if port != "" {
			return adoptOrphanDSHWeb(logPath, token, port, pid, trackedPID)
		}
		if refused == nil && au.Port() != "" && loopbackTarget(au.Host) {
			refused = au
		}
	}
	if su, err := url.Parse(state.URL); err == nil && state.URL != "" && loopbackTarget(su.Host) && su.Port() != "" {
		if token := su.Query().Get("token"); token != "" && !expired(deadline) && probeDSHWebToken(deadline, su.Port(), token) {
			logPath := state.Log
			if logPath == "" && len(logPaths) > 0 {
				logPath = logPaths[len(logPaths)-1]
			}
			pid, owned, _ := dshWebPortOwned(dshWebDeadlineCtx0(deadline), su.Port())
			if owned {
				return adoptOrphanDSHWeb(logPath, token, su.Port(), pid, trackedPID)
			}
		}
	}
	if refused != nil {
		// The announcement named a loopback port but its host refused every token. That refusal says
		// "this is not the host we recorded"; it does not say "this is ours to stop" — the port may
		// now hold an unrelated service, or another bothouse's DSH (#1255 阻塞二: pid != trackedPID
		// was the only check, and pid reuse plus a stale announcement was enough to kill a stranger).
		// So the stop needs the same ownership proof as an adoption, and a port that cannot be shown
		// to be ours is left alone; the caller starts a fresh host on a new port instead.
		pid, owned, why := dshWebPortOwned(dshWebDeadlineCtx0(deadline), refused.Port())
		switch {
		case pid == trackedPID:
			// The host this call is replacing; openDSHWeb stops it itself, before the takeover.
		case !owned:
			slog.Warn("dsh web: not stopping the host on the announced port: it is not this bridge's: "+
				why, "port", refused.Port())
		default:
			slog.Info("dsh web: stopping an untracked dsh web before starting a new one", "pid", pid, "port", refused.Port())
			if err := stopUntrackedDSHWeb(pid); err != nil {
				return DSHWeb{}, false, err
			}
		}
	}
	return DSHWeb{}, false, nil
}

// stopUntrackedDSHWeb is stopDSHWebForImport for a host takeOverOrphanDSHWeb found; tests swap it to
// see a stop without signalling the test process that serves the fake host.
var stopUntrackedDSHWeb = stopDSHWebForImport

// orphanDSHWebPort reads logPath's last announcement and returns it with its token, the loopback
// port whose host accepts that token and the pid of that host ("" / 0 when none does; au is nil when
// the log has no usable line). A candidate counts only when the token signs in *and* the listener is
// provably this bridge's DSH: the token alone is not ownership (#1255 阻塞一).
func orphanDSHWebPort(logPath string, state DSHWeb, deadline time.Time) (au *url.URL, token, port string, pid int) {
	announced := lastDSHWebURL(logPath)
	if announced == "" {
		return nil, "", "", 0
	}
	au, err := url.Parse(announced)
	if err != nil || au.Host == "" {
		return nil, "", "", 0
	}
	token = au.Query().Get("token")
	if token == "" {
		return au, "", "", 0
	}
	// `--public-url` announcements (the launchd unit passes the tailnet name) carry no port and a
	// non-loopback host, so the line alone cannot say where the host is: the port comes from the
	// recorded address, then from the loopback listeners. The token gate still decides — only a
	// port that answers GET /?token= with 303 can be adopted, so a wrong candidate is harmless.
	// Without this, a second `dsh web` was started, the plugin's instance lock refused it, and the
	// panel said 打不开 (2026-11-05 现场, notes/dsh-bughunt2-B-185-bugs.md 第 1 条).
	ports := make([]string, 0, 4)
	addPort := func(p string) {
		if p == "" {
			return
		}
		for _, c := range ports {
			if c == p {
				return
			}
		}
		ports = append(ports, p)
	}
	if au.Port() != "" && loopbackTarget(au.Host) {
		addPort(au.Port())
	}
	addPort(statePort(state.URL))
	take := func(p string) (string, int, bool) {
		if expired(deadline) {
			return "", 0, false
		}
		if !probeDSHWebToken(deadline, p, token) {
			return "", 0, false
		}
		pid, owned, why := dshWebPortOwned(dshWebDeadlineCtx0(deadline), p)
		if !owned {
			slog.Warn("dsh web: a port answers the announcement's token but is not this bridge's host: "+why, "port", p)
			return "", 0, false
		}
		return p, pid, true
	}
	for _, p := range ports {
		if got, gotPID, ok := take(p); ok {
			return au, token, got, gotPID
		}
	}
	if au.Port() == "" {
		ctx, cancel := dshWebDeadlineCtx(deadline)
		defer cancel()
		for _, p := range dshWebListenersFn(ctx) {
			addPort(p)
			if expired(deadline) {
				break
			}
			if got, gotPID, ok := take(p); ok {
				return au, token, got, gotPID
			}
		}
	}
	return au, token, "", 0
}

// adoptOrphanDSHWeb records the host on port, whose token signed in and whose pid belongs to this
// bridge, as the running `dsh web` and logPath as the log that proved it, so the next open and
// self-heal read that one first. pid comes from orphanDSHWebPort's ownership check, so a caller that
// reached here has already proved the host is ours; pid <= 0 (no lsof) is still allowed, the address
// and token being what the proxy uses.
func adoptOrphanDSHWeb(logPath, token, port string, pid, trackedPID int) (DSHWeb, bool, error) {
	if pid == trackedPID {
		return DSHWeb{}, false, nil
	}
	if _, membersErr := os.Stat(dshMembersFile()); membersErr == nil {
		// Roles still wait for import: the plugin reads them only at boot, so start over.
		if pid <= 0 {
			// Nothing proved which process to stop (owned is never true without a pid, but a caller
			// that could not read lsof must not end up signalling pid 0 — that is the process group).
			slog.Warn("dsh web: not stopping the host with roles waiting: no pid proves which process it is", "port", port)
			return DSHWeb{}, false, nil
		}
		slog.Info("dsh web: stopping an untracked dsh web before starting a new one", "pid", pid, "port", port)
		if err := stopUntrackedDSHWeb(pid); err != nil {
			return DSHWeb{}, false, err
		}
		return DSHWeb{}, false, nil
	}
	web := DSHWeb{URL: "http://127.0.0.1:" + port + "/?" + url.Values{"token": {token}}.Encode() + dshChannelsHash, PID: pid, Log: logPath}
	b, _ := json.Marshal(web)
	_ = os.WriteFile(dshWebStatePath(), b, 0o600)
	slog.Info("dsh web: adopted a running dsh web from the log", "pid", pid, "port", port, "log", logPath)
	return web, true, nil
}
