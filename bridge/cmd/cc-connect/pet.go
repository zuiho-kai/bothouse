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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/chenhg5/cc-connect/config"
)

const petUsage = `Usage: bothouse pet <start|stop|status>

Desktop pet: bothouse's own desktop pet (plugins/desktop-pet, forked from dsh-pet by PC2005-cloud, MIT) —
a transparent, always-on-top desktop window driven by the role events of this bothouse. Only roles bound
to the "dsh-pet" plugin (plugin page → role bindings, enabled) drive it; its right-click menu talks to
the bound role, shows bothouse usage, the team task board and opens the web admin.

Commands:
  start    Start the desktop pet in the background (installs it with npm on first use)
  stop     Close the desktop pet
  status   Show whether it is running, its port and log file

Environment:
  BOTHOUSE_PET_DIR       A built plugins/desktop-pet checkout to run (skips the install)
  BOTHOUSE_PET_PACKAGE   npm package (file or URL) to install instead of this release's bothouse-pet.tgz
`

// petPluginID is the role-binding plugin id that means "this role drives the desktop pet": the plugin
// page binds with PET_ADAPTER_ID = 'dsh-pet' (web/src/pages/Plugins/plugins/dshPetPlugin.tsx), which is
// also the npm package name.
const petPluginID = "dsh-pet"

// petPackageURL is the bundled pet's npm package for this bothouse version: release.yml attaches
// bothouse-pet.tgz (built from plugins/desktop-pet) to every release; dev builds take the latest one.
func petPackageURL() string {
	if p := os.Getenv("BOTHOUSE_PET_PACKAGE"); p != "" {
		return p
	}
	if petReleaseTag.MatchString(version) {
		return "https://github.com/zuiho-kai/bothouse/releases/download/" + version + "/bothouse-pet.tgz"
	}
	return "https://github.com/zuiho-kai/bothouse/releases/latest/download/bothouse-pet.tgz"
}

var petReleaseTag = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

type petPaths struct{ dir, stateFile, logFile, installDir string }

func petPathsFor(dataDir string) petPaths {
	dir := filepath.Join(dataDir, "pet")
	return petPaths{
		dir:        dir,
		stateFile:  filepath.Join(dir, "desktop.json"),
		logFile:    filepath.Join(dir, "desktop.log"),
		installDir: filepath.Join(dir, "app"),
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
	fmt.Println("Starting desktop pet (the first start installs it and downloads Electron) ...")
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

// findPet returns the command line that runs the bundled pet's standalone mode, installing the
// package for this version with npm when it is missing or was installed from another package.
func findPet(paths petPaths) ([]string, error) {
	node, nodeErr := exec.LookPath("node")
	if dir := os.Getenv("BOTHOUSE_PET_DIR"); dir != "" {
		if nodeErr != nil {
			return nil, fmt.Errorf("node was not found; install Node.js 22.12 or newer")
		}
		return []string{node, filepath.Join(dir, "lib", "standalone.js")}, nil
	}
	pkg := petPackageURL()
	marker := filepath.Join(paths.installDir, "package-source.txt")
	entry := filepath.Join(paths.installDir, "node_modules", "bothouse-pet", "lib", "standalone.js")
	if b, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(b)) == pkg {
		if _, err := os.Stat(entry); err == nil && nodeErr == nil {
			return []string{node, entry}, nil
		}
	}
	npm, err := exec.LookPath("npm")
	if err != nil || nodeErr != nil {
		return nil, fmt.Errorf("the desktop pet needs Node.js 22.12 or newer (node and npm on PATH)")
	}
	if err := os.MkdirAll(paths.installDir, 0o755); err != nil {
		return nil, err
	}
	fmt.Printf("installing the desktop pet from %s into %s ...\n", pkg, paths.installDir)
	cmd := exec.Command(npm, "install", "--prefix", paths.installDir, "--no-audit", "--no-fund", pkg)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("npm install %s: %w", pkg, err)
	}
	if _, err := os.Stat(entry); err != nil {
		return nil, fmt.Errorf("installed %s but %s is missing", pkg, entry)
	}
	_ = os.WriteFile(marker, []byte(pkg+"\n"), 0o644)
	return []string{node, entry}, nil
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
	// `pet start` creates it; make sure a direct `pet run` (and its state file) works too.
	if err := os.MkdirAll(paths.dir, 0o755); err != nil {
		return err
	}
	argv, err := findPet(paths)
	if err != nil {
		return err
	}
	port, err := freePort()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pet := newDshPetClient(port)
	relay := newPetRelay(pet)
	// One pet per bound role (#549): lay the pets out before the window opens, so it starts with them.
	layout := newPetLayout(newPetLayoutPaths(cfg.DataDir, petBundledRoot(argv)), relay, pet)
	if bound, err := fetchPetBindings(&http.Client{Timeout: 5 * time.Second}, managementURL(cfg), cfg.Management.Token); err == nil {
		relay.bound = bound
		layout.once(false)
	}
	go layout.run(ctx.Done())
	// The pet's menu (对话 / 查看余额 / 待办事项 / 碎碎念 / 打开 AI 设置) calls back into bothouse (pet_api.go).
	api := newPetAPI(relay, managementURL(cfg), cfg.Management.Token, resolveSocketPath(cfg.DataDir))
	apiURL, err := api.serve(ctx)
	if err != nil {
		return err
	}
	child := exec.Command(argv[0], append(argv[1:], "--port", strconv.Itoa(port))...)
	child.Env = append(os.Environ(), "BOTHOUSE_PET_API="+apiURL, "BOTHOUSE_PET_TOKEN="+api.secret,
		"BOTHOUSE_ADMIN_URL="+managementURL(cfg))
	child.Stdout, child.Stderr = os.Stdout, os.Stderr
	if err := child.Start(); err != nil {
		return fmt.Errorf("start %s: %w", strings.Join(argv, " "), err)
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
		return fmt.Errorf("desktop pet exited: %v", err)
	}
	return nil
}

// petBundledRoot is the pet package directory behind the command findPet returned (…/lib/standalone.js).
func petBundledRoot(argv []string) string {
	if len(argv) < 2 {
		return ""
	}
	return filepath.Dir(filepath.Dir(argv[len(argv)-1]))
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

// ---- relay: bothouse role events → dsh-pet ----

type petRelay struct {
	pet    *dshPetClient
	layout *petLayout // nil in tests: every role talks to "main"

	mu     sync.Mutex
	bound  map[string]string    // role_key → avatar pack ("" = none) of the roles bound to dsh-pet and enabled
	status map[string]string    // role_key → role status
	names  map[string]string    // role_key → display name
	assign map[string]petAssign // role_key → its pet (one role, one pet, #549)
	sent   map[string]string    // pet id → last work-status sent ("" = cleared)
	talk   *petTalk             // sessions, recent lines and pending 对话 of the bound roles (pet_api.go)
	logf   func(string, ...any)
	// out replaces the HTTP calls in tests: pet is the pet id, kind a work-status tier, "" (clear) or "speech".
	out func(pet, kind, text string)
}

func newPetRelay(pet *dshPetClient) *petRelay {
	return &petRelay{pet: pet, bound: map[string]string{}, status: map[string]string{}, names: map[string]string{},
		assign: map[string]petAssign{}, sent: map[string]string{}, talk: newPetTalk(),
		logf: func(f string, a ...any) { fmt.Printf("[pet] "+f+"\n", a...) }}
}

// petOf returns the pet a role drives ("main" until the layout has run).
func (r *petRelay) petOf(role string) string {
	if a, ok := r.assign[role]; ok {
		return a.Pet
	}
	return "main"
}

// roleOf returns the bound role behind a pet id ("" when none).
func (r *petRelay) roleOf(pet string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for role, a := range r.assign {
		if a.Pet == pet {
			return role
		}
	}
	return ""
}

type petRole struct {
	RoleKey     string `json:"role_key"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
}

type petEvent struct {
	Type       string  `json:"type"`
	RoleKey    string  `json:"role_key"`
	SessionKey string  `json:"session_key"`
	Text       string  `json:"text"`
	Draft      bool    `json:"draft"`
	Role       petRole `json:"role"`
}

type petBinding struct {
	PluginID   string `json:"plugin_id"`
	Enabled    bool   `json:"enabled"`
	AvatarPack string `json:"avatar_pack"`
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
			for k, pack := range bound {
				if pack != "" {
					k += "=" + pack
				}
				keys = append(keys, k)
			}
			sort.Strings(keys)
			s := strings.Join(keys, ",")
			if s != last {
				r.logf("roles driving the pet: [%s]", s)
			}
			r.mu.Lock()
			r.bound = bound
			r.mu.Unlock()
			if s != last && r.layout != nil {
				r.layout.request()
			}
			last = s
			r.apply()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func fetchPetBindings(c *http.Client, bridge, token string) (map[string]string, error) {
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

// petBoundRoles keeps the roles that turned the dsh-pet plugin on, with the avatar pack each picked;
// no fallback for unbound roles.
func petBoundRoles(bindings map[string][]petBinding) map[string]string {
	out := map[string]string{}
	for role, list := range bindings {
		for _, b := range list {
			if b.Enabled && b.PluginID == petPluginID {
				out[role] = strings.TrimSpace(b.AvatarPack)
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
	_, bound := r.bound[ev.RoleKey]
	r.names[ev.RoleKey] = petRoleName(ev.Role)
	if ev.Role.Status != "" {
		r.status[ev.RoleKey] = ev.Role.Status
	}
	r.mu.Unlock()
	if !bound {
		return
	}
	r.logf("%s %s", ev.RoleKey, ev.Type)
	if ev.SessionKey != "" {
		r.talk.seen(ev.RoleKey, ev.SessionKey)
	}
	switch ev.Type {
	case "speech":
		// Drafts are rewritten until final; like the sample plugins, only the final text is shown.
		if !ev.Draft && strings.TrimSpace(ev.Text) != "" {
			// A reply to the pet's 对话 goes back in the chat panel, which bubbles it itself.
			if !r.talk.spoke(ev.RoleKey, ev.SessionKey, ev.Text) {
				r.say(ev.RoleKey, ev.Text)
			}
		}
	case "celebrate", "error":
		// One-off: play it even though the role status may already be back to idle.
		r.mu.Lock()
		pet := r.petOf(ev.RoleKey)
		r.mu.Unlock()
		r.send(pet, petWorkState(ev.Type), petRoleName(ev.Role))
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

// apply sends every bound role's status to its own pet.
func (r *petRelay) apply() {
	type one struct{ pet, state, name string }
	r.mu.Lock()
	var list []one
	for role := range r.bound {
		list = append(list, one{r.petOf(role), petWorkState(r.status[role]), r.names[role]})
	}
	r.mu.Unlock()
	sort.Slice(list, func(i, j int) bool { return list[i].pet < list[j].pet })
	for _, o := range list {
		r.send(o.pet, o.state, o.name)
	}
}

func (r *petRelay) send(pet, state, task string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	sent := r.sent[pet]
	if state == sent && state != "success" && state != "error" {
		return
	}
	// success / error are one-offs: the pet plays them once and drops the bubble by itself
	// (README「工作状态联动」), so going idle after them must not cut them off.
	if state == "" && (sent == "success" || sent == "error") {
		return
	}
	r.sent[pet] = state
	r.emit(pet, state, task)
}

// emit must be called with r.mu held. ?pet= writes that pet's own work-status slot (bothouse fork of
// dsh-pet, src/host/routes/state.ts), so the pets of different roles move on their own.
func (r *petRelay) emit(pet, state, task string) {
	if r.out != nil {
		r.out(pet, state, task)
		return
	}
	var err error
	q := "/work-status?pet=" + url.QueryEscape(pet)
	if state == "" {
		err = r.pet.do("DELETE", q, nil)
	} else {
		err = r.pet.do("POST", q, map[string]any{"state": state, "task": task})
	}
	if err != nil {
		r.logf("work-status %s %q: %v", pet, state, err)
		r.sent[pet] = "?" // not delivered: the next apply sends it again
	} else {
		r.logf("work-status %s → %q (%s)", pet, state, task)
	}
}

// resend forgets what was sent, so the next apply repeats every pet's state (after the pets were rebuilt).
func (r *petRelay) resend() {
	r.mu.Lock()
	r.sent = map[string]string{}
	r.mu.Unlock()
	r.apply()
}

func (r *petRelay) say(role, text string) {
	text = strings.TrimSpace(text)
	r.mu.Lock()
	pet := r.petOf(role)
	r.mu.Unlock()
	if r.out != nil {
		r.out(pet, "speech", text)
		return
	}
	// No lock: without one, /broadcast behaves as before (openapi.yaml /lock「无锁时…行为与改造前逐字一致」).
	if err := r.pet.do("POST", "/broadcast?pet="+url.QueryEscape(pet), map[string]any{"text": text}); err != nil {
		r.logf("broadcast %s: %v", pet, err)
	} else {
		r.logf("bubble %s: %s", pet, text)
	}
}
