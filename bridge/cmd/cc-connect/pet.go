package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/chenhg5/cc-connect/config"
)

const petUsage = `Usage: bothouse pet <start|stop|status>

Desktop pet: runs dsh-pet (https://github.com/PC2005-cloud/dsh-pet) in its standalone mode — its own
transparent, always-on-top desktop window — and feeds it the role events of this bothouse. Only roles
bound to the "dsh-pet" plugin (plugin page → role bindings, enabled) drive the pet.

Commands:
  start    Start the desktop pet in the background (installs dsh-pet with npm on first use)
  stop     Close the desktop pet
  status   Show whether it is running, its port and log file

Environment:
  BOTHOUSE_DSH_PET_BIN   Path to an existing dsh-pet-standalone (skips the npm install)
`

// petPluginID is the role-binding plugin id that means "this role drives the desktop pet": the plugin
// page binds with PET_ADAPTER_ID = 'dsh-pet' (web/src/pages/Plugins/plugins/dshPetPlugin.tsx), which is
// also the npm package name.
const petPluginID = "dsh-pet"

// dshPetVersion is the dsh-pet release installed on first use (npm latest on 2026-11-09).
const dshPetVersion = "0.4.7"

type petPaths struct{ dir, stateFile, logFile, installDir string }

func petPathsFor(dataDir string) petPaths {
	dir := filepath.Join(dataDir, "pet")
	return petPaths{
		dir:        dir,
		stateFile:  filepath.Join(dir, "desktop.json"),
		logFile:    filepath.Join(dir, "desktop.log"),
		installDir: filepath.Join(dir, "dsh-pet"),
	}
}

// petRunState is what `pet run` writes so `stop`/`status` can find it.
type petRunState struct {
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Started string `json:"started"`
}

func runPet(args []string) {
	if len(args) == 0 || isHelpArg(args[0]) {
		fmt.Print(petUsage)
		return
	}
	configPath := resolveConfigPath("")
	cfg, err := config.LoadPermissive(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		os.Exit(1)
	}
	paths := petPathsFor(cfg.DataDir)
	switch args[0] {
	case "start":
		petStart(paths, configPath)
	case "stop":
		petStop(paths)
	case "status":
		petStatus(paths)
	case "run": // internal: the background process `start` launches
		if err := petRun(cfg, paths); err != nil {
			fmt.Fprintf(os.Stderr, "bothouse pet: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "bothouse pet: unknown command %q\n\n%s", args[0], petUsage)
		os.Exit(2)
	}
}

func readPetState(paths petPaths) (petRunState, bool) {
	var st petRunState
	b, err := os.ReadFile(paths.stateFile)
	if err != nil || json.Unmarshal(b, &st) != nil || st.PID <= 0 {
		return st, false
	}
	return st, petAlive(st)
}

// petAlive asks the dsh-pet the relay started; a stale state file (crash, reboot) answers nothing.
func petAlive(st petRunState) bool {
	c := &http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/health", st.Port))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func petFail(err error) {
	fmt.Fprintf(os.Stderr, "bothouse pet: %v\n", err)
	os.Exit(1)
}

func petStart(paths petPaths, configPath string) {
	if st, alive := readPetState(paths); alive {
		fmt.Printf("Desktop pet is already running (port %d).\n", st.Port)
		return
	}
	if err := os.MkdirAll(paths.dir, 0o755); err != nil {
		petFail(err)
	}
	_ = os.Remove(paths.stateFile)
	exe, err := os.Executable()
	if err != nil {
		petFail(err)
	}
	logf, err := os.OpenFile(paths.logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		petFail(err)
	}
	defer logf.Close()
	cmd := exec.Command(exe, "--config", configPath, "pet", "run")
	cmd.Stdout, cmd.Stderr = logf, logf
	detachPetProcess(cmd)
	if err := cmd.Start(); err != nil {
		petFail(fmt.Errorf("start: %w", err))
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	fmt.Println("Starting desktop pet (the first start installs dsh-pet and downloads Electron) ...")
	for {
		if st, alive := readPetState(paths); alive {
			fmt.Printf("Desktop pet started (port %d). Log: %s\n", st.Port, paths.logFile)
			return
		}
		select {
		case <-done:
			petFail(fmt.Errorf("it exited, see %s", paths.logFile))
		case <-time.After(time.Second):
		}
	}
}

func petStop(paths petPaths) {
	st, alive := readPetState(paths)
	if !alive {
		fmt.Println("Desktop pet is not running.")
		_ = os.Remove(paths.stateFile)
		return
	}
	// dsh-pet's own stop; the relay exits with it. Kill the relay (and what it started) only as a fallback.
	if newDshPetClient(st.Port).shutdown() != nil {
		stopPetProcess(st.PID)
	}
	for i := 0; i < 20 && petAlive(st); i++ { // up to 10 s
		time.Sleep(500 * time.Millisecond)
	}
	_ = os.Remove(paths.stateFile)
	if petAlive(st) {
		petFail(fmt.Errorf("still running on port %d, see %s", st.Port, paths.logFile))
	}
	fmt.Println("Desktop pet stopped.")
}

func petStatus(paths petPaths) {
	if st, alive := readPetState(paths); alive {
		fmt.Printf("running  port %d  since %s\nlog: %s\n", st.Port, st.Started, paths.logFile)
		return
	}
	fmt.Printf("not running\nlog: %s\n", paths.logFile)
}

// findDshPet returns the dsh-pet-standalone command, installing dsh-pet with npm when none is found.
func findDshPet(paths petPaths) (string, error) {
	if p := os.Getenv("BOTHOUSE_DSH_PET_BIN"); p != "" {
		return p, nil
	}
	name := "dsh-pet-standalone"
	if runtime.GOOS == "windows" {
		name += ".cmd"
	}
	local := filepath.Join(paths.installDir, "node_modules", ".bin", name)
	if _, err := os.Stat(local); err == nil {
		return local, nil
	}
	if p, err := exec.LookPath("dsh-pet-standalone"); err == nil {
		return p, nil
	}
	npm, err := exec.LookPath("npm")
	if err != nil {
		return "", fmt.Errorf("dsh-pet is not installed and npm was not found; install Node.js, or `npm install -g dsh-pet`")
	}
	fmt.Printf("installing dsh-pet@%s into %s ...\n", dshPetVersion, paths.installDir)
	cmd := exec.Command(npm, "install", "--prefix", paths.installDir, "dsh-pet@"+dshPetVersion)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("npm install dsh-pet: %w", err)
	}
	return local, nil
}

// freePort asks the OS for a free loopback port, so the relay knows where dsh-pet listens (dsh-pet
// itself would silently move on when its default is taken).
func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// managementURL mirrors runWeb: management.port, or the web admin's default port when unset.
func managementURL(cfg *config.Config) string {
	port := cfg.Management.Port
	if port == 0 {
		port = 9820 // same default as runWeb (web.go)
	}
	return fmt.Sprintf("http://127.0.0.1:%d", port)
}

func petRun(cfg *config.Config, paths petPaths) error {
	if cfg.Management.Enabled == nil || !*cfg.Management.Enabled {
		return fmt.Errorf("the web admin is off; run `bothouse web` once to switch it on")
	}
	bin, err := findDshPet(paths)
	if err != nil {
		return err
	}
	port, err := freePort()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	child := exec.Command(bin, "--port", strconv.Itoa(port))
	child.Stdout, child.Stderr = os.Stdout, os.Stderr
	if err := child.Start(); err != nil {
		return fmt.Errorf("start %s: %w", bin, err)
	}
	st := petRunState{PID: os.Getpid(), Port: port, Started: time.Now().Format(time.RFC3339)}
	b, _ := json.Marshal(st)
	if err := os.WriteFile(paths.stateFile, b, 0o644); err != nil {
		return err
	}
	defer os.Remove(paths.stateFile)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		if newDshPetClient(port).shutdown() != nil {
			interruptPetChild(child) // dsh-pet's Ctrl+C
		}
	}()

	pet := newDshPetClient(port)
	relay := newPetRelay(pet)
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	// Feed it only once its HTTP side is up; until then the window has nothing to show anyway.
	go func() {
		for !petAlive(st) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
		relay.follow(ctx, managementURL(cfg), cfg.Management.Token)
	}()
	err = <-exited
	cancel()
	if err != nil {
		return fmt.Errorf("dsh-pet exited: %v", err)
	}
	return nil
}

// ---- dsh-pet HTTP client (contract: dsh-pet API.md / openapi.yaml) ----

type dshPetClient struct {
	base string
	port int
	http *http.Client
}

// dshPetHome mirrors dsh-pet's dshHomeDir (src/host/helper/electron.ts): DSH_HOME, else ~/.dsh.
func dshPetHome() string {
	if h := os.Getenv("DSH_HOME"); h != "" {
		return h
	}
	home := os.Getenv("USERPROFILE")
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	return filepath.Join(home, ".dsh")
}

// dshPetToken reads the write token dsh-pet's standalone mode keeps for local launchers in
// $DSH_HOME/dsh-pet/standalone-runtime.json (src/standalone/runtime-state.ts); only the entry of the
// instance on our port counts.
func dshPetToken(port int) string {
	b, err := os.ReadFile(filepath.Join(dshPetHome(), "dsh-pet", "standalone-runtime.json"))
	if err != nil {
		return ""
	}
	var rt struct {
		Port  int    `json:"port"`
		Token string `json:"token"`
	}
	if json.Unmarshal(b, &rt) != nil || rt.Port != port {
		return ""
	}
	return rt.Token
}

// shutdown is dsh-pet's graceful stop (API.md「独立模式」POST /shutdown).
func (c *dshPetClient) shutdown() error {
	req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/shutdown", c.port), nil)
	return c.send(req)
}

func (c *dshPetClient) do(method, path string, body any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.send(req)
}

func (c *dshPetClient) send(req *http.Request) error {
	if t := dshPetToken(c.port); t != "" {
		req.Header.Set("X-DSH-Pet-Token", t)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s %s: %d %s", req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

func newDshPetClient(port int) *dshPetClient {
	return &dshPetClient{base: fmt.Sprintf("http://127.0.0.1:%d/dsh-pet-7340", port), port: port, http: &http.Client{Timeout: 10 * time.Second}}
}

// petID picks the pet to talk over: "main" (dsh-pet's default pet) when present, else the first one.
func (c *dshPetClient) petID() string {
	resp, err := c.http.Get(c.base + "/state")
	if err != nil {
		return "main"
	}
	defer resp.Body.Close()
	var st struct {
		Pets map[string]json.RawMessage `json:"pets"`
	}
	if json.NewDecoder(resp.Body).Decode(&st) != nil || len(st.Pets) == 0 {
		return "main"
	}
	if _, ok := st.Pets["main"]; ok {
		return "main"
	}
	ids := make([]string, 0, len(st.Pets))
	for id := range st.Pets {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids[0]
}

// petWorkState maps a bothouse role status to a dsh-pet work-status tier ("" = idle → clear the slot).
func petWorkState(status string) string {
	switch status {
	case "thinking":
		return "thinking"
	case "working":
		return "working"
	case "celebrate":
		return "success"
	case "error":
		return "error"
	}
	return ""
}

// petStatusOrder is role-events.md's merge order for one role open in several places,
// "error > working > thinking > celebrate > idle", reused to merge several bound roles into one pet.
var petStatusOrder = []string{"idle", "celebrate", "thinking", "working", "error"}

func petRank(status string) int {
	for i, s := range petStatusOrder {
		if s == status {
			return i
		}
	}
	return 0
}

// ---- relay: bothouse role events → dsh-pet ----

type petRelay struct {
	pet *dshPetClient

	mu     sync.Mutex
	bound  map[string]bool   // role_key → bound to dsh-pet and enabled
	status map[string]string // role_key → merged role status
	names  map[string]string // role_key → display name
	sent   string            // last work-status sent ("" = cleared)
	logf   func(string, ...any)
	// out replaces the HTTP calls in tests: kind is a work-status tier, "" (clear) or "speech".
	out func(kind, text string)
}

func newPetRelay(pet *dshPetClient) *petRelay {
	return &petRelay{pet: pet, bound: map[string]bool{}, status: map[string]string{}, names: map[string]string{},
		logf: func(f string, a ...any) { fmt.Printf("[pet] "+f+"\n", a...) }}
}

type petRole struct {
	RoleKey     string `json:"role_key"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
}

type petEvent struct {
	Type    string  `json:"type"`
	RoleKey string  `json:"role_key"`
	Text    string  `json:"text"`
	Draft   bool    `json:"draft"`
	Role    petRole `json:"role"`
}

type petBinding struct {
	PluginID string `json:"plugin_id"`
	Enabled  bool   `json:"enabled"`
}

func (r *petRelay) follow(ctx context.Context, bridge, token string) {
	go r.pollBindings(ctx, bridge, token)
	for ctx.Err() == nil {
		if err := r.stream(ctx, bridge, token); err != nil && ctx.Err() == nil {
			r.logf("role events: %v (reconnecting)", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(3 * time.Second): // same reconnect delay as plugins/template lib/bothouse.mjs
		}
	}
}

// pollBindings re-reads the bindings like followRoles in plugins/template/lib/bothouse.mjs
// (「绑定变了 2 秒内生效」, docs/plugins/plugin-dev.md).
func (r *petRelay) pollBindings(ctx context.Context, bridge, token string) {
	c := &http.Client{Timeout: 5 * time.Second}
	last := "-"
	for {
		bound, err := fetchPetBindings(c, bridge, token)
		if err != nil {
			r.logf("role bindings: %v", err)
		} else {
			keys := make([]string, 0, len(bound))
			for k := range bound {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			if s := strings.Join(keys, ","); s != last {
				last = s
				r.logf("roles driving the pet: [%s]", s)
			}
			r.mu.Lock()
			r.bound = bound
			r.mu.Unlock()
			r.apply()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func fetchPetBindings(c *http.Client, bridge, token string) (map[string]bool, error) {
	req, _ := http.NewRequest("GET", bridge+"/api/v1/plugins/role-bindings", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var body struct {
		Data struct {
			Bindings map[string][]petBinding `json:"bindings"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return petBoundRoles(body.Data.Bindings), nil
}

// petBoundRoles keeps the roles that turned the dsh-pet plugin on; no fallback for unbound roles.
func petBoundRoles(bindings map[string][]petBinding) map[string]bool {
	out := map[string]bool{}
	for role, list := range bindings {
		for _, b := range list {
			if b.Enabled && b.PluginID == petPluginID {
				out[role] = true
			}
		}
	}
	return out
}

func (r *petRelay) stream(ctx context.Context, bridge, token string) error {
	req, err := http.NewRequestWithContext(ctx, "GET", bridge+"/api/v1/roles/events", nil)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	r.logf("connected to %s/api/v1/roles/events", bridge)
	return r.readSSE(resp.Body)
}

func (r *petRelay) readSSE(body io.Reader) error {
	rd := bufio.NewReader(body)
	kind, data := "", ""
	for {
		line, err := rd.ReadString('\n')
		line = strings.TrimRight(line, "\r\n")
		switch {
		case line == "":
			if data != "" {
				r.handle(kind, []byte(data))
			}
			kind, data = "", ""
		case strings.HasPrefix(line, "event:"):
			kind = strings.TrimSpace(line[len("event:"):])
		case strings.HasPrefix(line, "data:"):
			if data != "" {
				data += "\n"
			}
			data += strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
		}
		if err != nil {
			return err
		}
	}
}

func (r *petRelay) handle(kind string, data []byte) {
	if kind == "snapshot" {
		var snap struct {
			Roles []petRole `json:"roles"`
		}
		if json.Unmarshal(data, &snap) != nil {
			return
		}
		r.mu.Lock()
		r.status = map[string]string{}
		for _, role := range snap.Roles {
			r.status[role.RoleKey] = role.Status
			r.names[role.RoleKey] = petRoleName(role)
		}
		r.mu.Unlock()
		r.apply()
		return
	}
	var ev petEvent
	if json.Unmarshal(data, &ev) != nil || ev.RoleKey == "" {
		return
	}
	if ev.Type == "" {
		ev.Type = kind
	}
	r.mu.Lock()
	bound := r.bound[ev.RoleKey]
	r.names[ev.RoleKey] = petRoleName(ev.Role)
	if ev.Role.Status != "" {
		r.status[ev.RoleKey] = ev.Role.Status
	}
	r.mu.Unlock()
	if !bound {
		return
	}
	r.logf("%s %s", ev.RoleKey, ev.Type)
	switch ev.Type {
	case "speech":
		// Drafts are rewritten until final; like the sample plugins, only the final text is shown.
		if !ev.Draft && strings.TrimSpace(ev.Text) != "" {
			r.say(ev.Text)
		}
	case "celebrate", "error":
		// One-off: play it even though the merged role status may already be back to idle.
		r.send(petWorkState(ev.Type), petRoleName(ev.Role))
	default:
		r.apply()
	}
}

func petRoleName(role petRole) string {
	if role.DisplayName != "" {
		return role.DisplayName
	}
	if role.Name != "" {
		return role.Name
	}
	return role.RoleKey
}

// apply sends the merged status of all bound roles to the pet.
func (r *petRelay) apply() {
	r.mu.Lock()
	best, who := "idle", ""
	keys := make([]string, 0, len(r.bound))
	for k := range r.bound {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if s := r.status[k]; petRank(s) > petRank(best) {
			best, who = s, r.names[k]
		}
	}
	r.mu.Unlock()
	r.send(petWorkState(best), who)
}

func (r *petRelay) send(state, task string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if state == r.sent && state != "success" && state != "error" {
		return
	}
	// success / error are terminal tiers: dsh-pet plays them once and drops the bubble by itself
	// (README「工作状态联动」), so going idle after them must not cut them off.
	if state == "" && (r.sent == "success" || r.sent == "error") {
		return
	}
	r.sent = state
	r.emit(state, task)
}

// emit must be called with r.mu held.
func (r *petRelay) emit(state, task string) {
	if r.out != nil {
		r.out(state, task)
		return
	}
	var err error
	if state == "" {
		err = r.pet.do("DELETE", "/work-status", nil)
	} else {
		err = r.pet.do("POST", "/work-status", map[string]any{"state": state, "task": task})
	}
	if err != nil {
		r.logf("work-status %q: %v", state, err)
		r.sent = "?" // not delivered: the next apply sends it again
	} else {
		r.logf("work-status → %q (%s)", state, task)
	}
}

func (r *petRelay) say(text string) {
	text = strings.TrimSpace(text)
	if r.out != nil {
		r.out("speech", text)
		return
	}
	// No lock: without one, /broadcast behaves as before (openapi.yaml /lock「无锁时…行为与改造前逐字一致」).
	if err := r.pet.do("POST", "/broadcast?pet="+url.QueryEscape(r.pet.petID()), map[string]any{"text": text}); err != nil {
		r.logf("broadcast: %v", err)
	} else {
		r.logf("bubble: %s", text)
	}
}
