package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/tidwall/pretty"
)

// One role, one desktop pet (#549). The first bound role keeps the pet's own "main"; every other bound
// role gets its own pet as one of the pet's "kinds" (docs/CONFIG.md「方式四：额外宠物」):
// $DSH_HOME/dsh-pet/pet/<pet id>-config.json with the stock animation table and one instance. A kind has no
// clips of its own, so the pet dresses it in a skin (src/host/skins.ts): it asks /skin?pet=<pet id> which
// role it is, and wears that role's built-in skin — or, when the role was given an imported avatar pack on
// the plugin page, that pack, which this file turns into a skin under $DSH_HOME/dsh-pet/skins/ (WebP sprite
// packs are encoded to WebM once with ffmpeg, the same encode as hunmer/aboutme-pets'
// spritesheet_to_video_pet.py).

// petKindPrefix marks the kind files bothouse owns (pet ids are bh-<role key>); any other file under pet/
// is the user's and is left alone.
const petKindPrefix = "bh-"

// petSkinPrefix names the skin made from an imported pack: $DSH_HOME/dsh-pet/skins/bh-pack-<pack>/.
const petSkinPrefix = "bh-pack-"

// petRule picks a pack action for a role status: category and name patterns, tried in order.
type petRule struct{ category, name *regexp.Regexp }

func rx(s string) *regexp.Regexp { return regexp.MustCompile(s) }

// petRules mirrors PET_MATCH_RULES in bridge/web/src/pages/Plugins/plugins/dshPetPlugin.tsx (来源：本机
// hunmer/aboutme-pets dsh1、claude 两包 actions.json 的真实动作名和 category，2026-11-09 核对), so the
// plugin page preview and the desktop pet play the same clip for a status.
var petRules = map[string][]petRule{
	"idle":      {{category: rx(`^待机$`)}, {name: rx(`(?i)待机|打瞌睡|idle`)}},
	"working":   {{category: rx(`^工作状态$`), name: rx(`忙碌`)}, {name: rx(`(?i)写代码|加班|忙碌|working|coding`)}},
	"thinking":  {{category: rx(`^工作状态$`), name: rx(`思考`)}, {name: rx(`(?i)思考|thinking`)}},
	"celebrate": {{category: rx(`^工作状态$`), name: rx(`庆祝|雀跃`)}, {name: rx(`(?i)庆祝|雀跃|狂喜|celebrate`)}},
	"error":     {{category: rx(`^工作状态$`), name: rx(`叹气|冒汗|垂头`)}, {name: rx(`(?i)叹气|冒汗|垂头|扶额|error`)}},
	"speech":    {{category: rx(`^碎碎念$`)}, {name: rx(`(?i)说话|碎碎念|speech`)}},
}

// petMatch returns the action for a status ("" when nothing fits): an explicit state wins, then the rules.
func petMatch(actions []core.PetPackAction, state string) string {
	for _, a := range actions {
		if a.State == state {
			return a.ID
		}
	}
	for _, rule := range petRules[state] {
		for _, a := range actions {
			if rule.category != nil && !rule.category.MatchString(a.Category) {
				continue
			}
			if rule.name != nil && !rule.name.MatchString(a.Name) {
				continue
			}
			return a.ID
		}
	}
	return ""
}

// petSkinStates are the eight state clips a skin holds (src/host/skins.ts); each is filled from the pack
// action that petMatch picks for the matching role status. sleep and drag stay empty: the pet falls back to idle.
var petSkinStates = map[string]string{"idle": "idle", "talk": "speech", "think": "thinking", "work": "working", "happy": "celebrate", "surprise": "error"}

// ---- where the pet's files live ----

type petLayoutPaths struct {
	petDir   string // $DSH_HOME/dsh-pet/pet (the pet's kind directory)
	skins    string // $DSH_HOME/dsh-pet/skins (installed skins, src/host/skins.ts installedRoot)
	mainConf string // $DSH_HOME/dsh-pet/main-config.jsonc
	packs    string // bothouse's pack store (<DataDir>/pets, same as GET /api/v1/plugins/pets)
	status   string // <DataDir>/pet/packs: one <pack>.json per conversion, read by the plugin page
	bundled  string // the installed pet package root ("" when unknown)
}

func newPetLayoutPaths(dataDir, bundled string) petLayoutPaths {
	home := filepath.Join(dshPetHome(), "dsh-pet")
	return petLayoutPaths{
		petDir:   filepath.Join(home, "pet"),
		skins:    filepath.Join(home, "skins"),
		mainConf: filepath.Join(home, "main-config.jsonc"),
		packs:    filepath.Join(dataDir, "pets"),
		status:   filepath.Join(dataDir, "pet", "packs"),
		bundled:  bundled,
	}
}

// skinDir is where an imported pack becomes a skin the pet can wear.
func (p petLayoutPaths) skinDir(pack string) string {
	return filepath.Join(p.skins, petSkinPrefix+pack)
}

// readJSONC reads a JSONC file the way dsh-pet does (comments and trailing commas allowed).
func readJSONC(path string, out any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(pretty.Spec(b), out)
}

// petMainLook is the main pet's size and corner: new pets copy its size and line up next to it.
type petMainLook struct {
	Size     int
	Corner   string
	MarginX  int
	MarginY  int
	Display  string
	WorkOn   bool
	Whisper  bool
	Fixed    bool
	Balance  bool
	HasEntry bool
}

func readPetMainLook(p petLayoutPaths) petMainLook {
	// 默认值沿用桌宠包内 assets/config.jsonc 的 pets[0]（size 462、右上角、边距 24/100）。
	look := petMainLook{Size: 462, Corner: "top-right", MarginX: 24, MarginY: 100, Display: "both", WorkOn: true, Whisper: true}
	var conf struct {
		Pets []struct {
			ID       string `json:"id"`
			Size     int    `json:"size"`
			Display  string `json:"display"`
			Position struct {
				Corner  string `json:"corner"`
				MarginX *int   `json:"marginX"`
				MarginY *int   `json:"marginY"`
			} `json:"position"`
		} `json:"pets"`
	}
	src := p.mainConf
	if _, err := os.Stat(src); err != nil && p.bundled != "" {
		src = filepath.Join(p.bundled, "assets", "config.jsonc")
	}
	if readJSONC(src, &conf) != nil || len(conf.Pets) == 0 {
		return look
	}
	m := conf.Pets[0]
	for _, pet := range conf.Pets {
		if pet.ID == "main" {
			m = pet
		}
	}
	look.HasEntry = true
	if m.Size > 0 {
		look.Size = m.Size
	}
	if m.Display != "" {
		look.Display = m.Display
	}
	if m.Position.Corner != "" {
		look.Corner = m.Position.Corner
	}
	if m.Position.MarginX != nil {
		look.MarginX = *m.Position.MarginX
	}
	if m.Position.MarginY != nil {
		look.MarginY = *m.Position.MarginY
	}
	return look
}

// ---- turning a pack into the pet's WebM clips ----

// petPackStatus is <DataDir>/pet/packs/<pack>.json: how far the desktop clips of a pack are.
type petPackStatus struct {
	Pack    string `json:"pack"`
	State   string `json:"state"` // converting | ready | failed
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Error   string `json:"error,omitempty"`
	Updated string `json:"updated"`
}

func writePetPackStatus(p petLayoutPaths, st petPackStatus) {
	st.Updated = time.Now().Format(time.RFC3339)
	b, _ := json.MarshalIndent(st, "", "  ")
	if os.MkdirAll(p.status, 0o755) == nil {
		_ = os.WriteFile(filepath.Join(p.status, st.Pack+".json"), b, 0o644)
	}
}

// petSkinReady reports whether the pack's skin is complete (the pet only wears a skin with .installed).
func petSkinReady(p petLayoutPaths, pack string) bool {
	_, err := os.Stat(filepath.Join(p.skinDir(pack), ".installed"))
	return err == nil
}

// petPrepareClips turns a pack into a skin: <action>.webm for every action (WebM packs linked or copied,
// WebP sprite packs encoded with ffmpeg), the eight state clips the pet falls back to, then .installed.
// Existing clips are kept, so an interrupted run resumes.
func petPrepareClips(ctx context.Context, p petLayoutPaths, info core.PetPackInfo, logf func(string, ...any)) error {
	dir := p.skinDir(info.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	var ffmpeg string
	if info.Format == "webp-sprite" {
		var err error
		if ffmpeg, err = exec.LookPath("ffmpeg"); err != nil {
			return fmt.Errorf("需要 ffmpeg 才能把 WebP 精灵图转成桌宠能放的透明视频（macOS：brew install ffmpeg；Windows：winget install ffmpeg）")
		}
	}
	total := len(info.Actions)
	st := petPackStatus{Pack: info.ID, State: "converting", Total: total}
	writePetPackStatus(p, st)
	var (
		mu    sync.Mutex
		done  int
		first error
	)
	jobs := make(chan core.PetPackAction)
	workers := cap(petConvertSlots)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for a := range jobs {
				err := petPrepareClip(ctx, ffmpeg, info.LocalPath, dir, a)
				mu.Lock()
				done++
				if err != nil && first == nil {
					first = fmt.Errorf("%s: %w", a.ID, err)
				}
				if done%10 == 0 || done == total {
					st.Done = done
					writePetPackStatus(p, st)
				}
				mu.Unlock()
			}
		}()
	}
	for _, a := range info.Actions {
		jobs <- a
	}
	close(jobs)
	wg.Wait()
	st.Done = done
	if first != nil {
		st.State, st.Error = "failed", first.Error()
		writePetPackStatus(p, st)
		return first
	}
	for state, status := range petSkinStates {
		id := petMatch(info.Actions, status)
		if id == "" {
			continue // the pet falls back to idle.webm
		}
		dst := filepath.Join(dir, state+".webm")
		_ = os.Remove(dst)
		if err := os.Link(filepath.Join(dir, id+".webm"), dst); err != nil {
			if err := copyPetFile(filepath.Join(dir, id+".webm"), dst); err != nil {
				return err
			}
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "idle.webm")); err != nil && len(info.Actions) > 0 {
		if err := copyPetFile(filepath.Join(dir, info.Actions[0].ID+".webm"), filepath.Join(dir, "idle.webm")); err != nil {
			return err
		}
	}
	mark, _ := json.Marshal(map[string]string{"from": "bothouse import", "pack": info.ID})
	if err := os.WriteFile(filepath.Join(dir, ".installed"), append(mark, '\n'), 0o644); err != nil {
		return err
	}
	st.State = "ready"
	writePetPackStatus(p, st)
	logf("pack %s: skin ready in %s (%d clips)", info.ID, dir, total)
	return nil
}

// petConvertSlots caps ffmpeg runs across all packs at half the CPUs (two packs at once used to start
// a full set each and starve the machine).
var petConvertSlots = make(chan struct{}, max(1, runtime.NumCPU()/2))

func petPrepareClip(ctx context.Context, ffmpeg, packDir, outDir string, a core.PetPackAction) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	out := filepath.Join(outDir, a.ID+".webm")
	if fi, err := os.Stat(out); err == nil && fi.Size() > 0 {
		return nil
	}
	src := filepath.Join(packDir, filepath.FromSlash(a.File))
	tmp := out + ".part"
	if ffmpeg == "" { // already WebM
		if err := os.Link(src, tmp); err != nil {
			if err := copyPetFile(src, tmp); err != nil {
				return err
			}
		}
		return os.Rename(tmp, out)
	}
	// Same encode as hunmer/aboutme-pets spritesheet_to_video_pet.py (VP9 with alpha), but the sheet is
	// decoded once and cut with ffmpeg's untile filter instead of looping the image and cropping frame n:
	// 实测（本机 2026-11-09，claude「写代码」120 帧 640×360，机器同时在转两包）：loop+crop 135 s，untile 38 s，
	// 输出逐帧相同。crf 30 + realtime instead of its crf 20：unloaded 5.7 s / 1.47 MB → 4.5 s / 1.02 MB,
	// no visible difference in a 260–460 px pet window.
	rows := (a.FrameCount + a.Columns - 1) / a.Columns
	vf := fmt.Sprintf("untile=%dx%d,setpts=N/(%g*TB),format=yuva420p", a.Columns, rows, a.FPS)
	fps := fmt.Sprintf("%g", a.FPS)
	args := []string{"-hide_banner", "-nostdin", "-y", "-v", "error",
		"-i", src, "-vf", vf, "-frames:v", fmt.Sprint(a.FrameCount), "-r", fps,
		"-c:v", "libvpx-vp9", "-auto-alt-ref", "0", "-pix_fmt", "yuva420p",
		"-row-mt", "1", "-b:v", "0", "-crf", "30", "-deadline", "realtime", "-cpu-used", "8",
		"-metadata:s:v:0", "alpha_mode=1", "-f", "webm", tmp}
	petConvertSlots <- struct{}{}
	defer func() { <-petConvertSlots }()
	// CommandContext: `pet stop` ends `pet run`, and with it every conversion still running.
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("ffmpeg: %v %s", err, strings.TrimSpace(stderr.String()))
	}
	return os.Rename(tmp, out)
}

func copyPetFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// ---- the layout: which role is which pet ----

// petAssign is one bound role on the desktop.
type petAssign struct {
	Role string // role key, bridge:<project> or dsh:<id>
	Pack string // imported avatar pack picked on the plugin page ("" = the role's built-in skin)
	Pet  string // dsh-pet instance id; also the kind prefix (asset root) of its pet/<id>-config.json
}

// petInstanceID derives the pet id from the role key ("bridge:deep" → "bh-bridge-deep"); dsh-pet ids
// may not hold \\ / : or control characters (src/host/config/constants.ts ID_FORBIDDEN) and are at most
// 64 long (MAX_PET_ID_LENGTH).
func petInstanceID(role string) string {
	var b strings.Builder
	for _, r := range role {
		switch {
		case r == '\\' || r == '/' || r == ':' || r < 0x20:
			b.WriteByte('-')
		default:
			b.WriteRune(r)
		}
	}
	id := petKindPrefix + b.String()
	if r := []rune(id); len(r) > 64 { // MAX_PET_ID_LENGTH
		id = string(r[:64])
	}
	return id
}

// petPlan decides the pets: the first role (by key — the same role /skin used to name before #549) keeps
// the existing "main" pet, so one bound role behaves as before; every other role gets its own pet.
func petPlan(roles []string, packs map[string]string) []petAssign {
	sorted := append([]string(nil), roles...)
	sort.Strings(sorted)
	out := make([]petAssign, 0, len(sorted))
	for i, role := range sorted {
		a := petAssign{Role: role, Pack: packs[role], Pet: "main"}
		if i > 0 {
			a.Pet = petInstanceID(role)
		}
		out = append(out, a)
	}
	return out
}

// petKindFiles renders one kind file per extra pet: the stock animation table (the skin maps every name to
// its clips) and one instance. They line up beside the main pet, half a pet apart (the characters fill
// about the middle half of their 640×360 frames), so they do not cover each other.
func petKindFiles(plan []petAssign, look petMainLook, anims map[string]any, weights map[string]any) map[string][]byte {
	files := map[string][]byte{}
	slot := 0
	for _, a := range plan {
		if a.Pet == "main" {
			continue
		}
		slot++
		conf := map[string]any{
			"_comment": "bothouse 生成（bothouse pet run，一个角色一只桌宠）；这只穿角色自己的形象，手改会被覆盖。",
			"pets": []any{map[string]any{
				// name is the role key without "bridge:": stable, so display names never rewrite the file.
				"id": a.Pet, "name": strings.TrimPrefix(a.Role, "bridge:"), "size": look.Size,
				"balanceEnabled": false, "whisperEnabled": true, "workStatusEnabled": true, "fixedEnabled": false,
				"display":  "desktop",
				"position": map[string]any{"corner": look.Corner, "marginX": look.MarginX + slot*look.Size/2, "marginY": look.MarginY},
			}},
			"animations":       anims,
			"animationWeights": weights,
		}
		b, _ := json.MarshalIndent(conf, "", "  ")
		files[a.Pet+"-config.json"] = append(b, '\n')
	}
	return files
}

// petWriteKinds writes the kind files and removes bothouse's stale ones; it reports whether anything
// changed (then the pet has to reload).
func petWriteKinds(p petLayoutPaths, files map[string][]byte) (bool, error) {
	if err := os.MkdirAll(p.petDir, 0o755); err != nil {
		return false, err
	}
	changed := false
	for name, b := range files {
		path := filepath.Join(p.petDir, name)
		if old, err := os.ReadFile(path); err == nil && bytes.Equal(old, b) {
			continue
		}
		if err := core.AtomicWriteFile(path, b, 0o644); err != nil {
			return changed, err
		}
		changed = true
	}
	entries, _ := os.ReadDir(p.petDir)
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasPrefix(n, petKindPrefix) || !strings.HasSuffix(n, "-config.json") {
			continue
		}
		if _, keep := files[n]; !keep {
			if err := os.Remove(filepath.Join(p.petDir, n)); err == nil {
				changed = true
			}
		}
	}
	return changed, nil
}

// petLayout keeps the pet's kinds in step with the role bindings: it runs once before the pet starts and
// again whenever the bound roles or their packs change.
type petLayout struct {
	paths petLayoutPaths
	relay *petRelay
	pet   *dshPetClient
	kick  chan struct{}
	ctx   context.Context // ends with `pet run`; conversions stop with it

	mu        sync.Mutex
	preparing map[string]bool
	failed    map[string]string // pack → why it cannot be used (log and plugin page)
}

func newPetLayout(ctx context.Context, paths petLayoutPaths, relay *petRelay, pet *dshPetClient) *petLayout {
	l := &petLayout{ctx: ctx, paths: paths, relay: relay, pet: pet, kick: make(chan struct{}, 1),
		preparing: map[string]bool{}, failed: map[string]string{}}
	relay.layout = l
	return l
}

func (l *petLayout) request() {
	select {
	case l.kick <- struct{}{}:
	default:
	}
}

func (l *petLayout) run(done <-chan struct{}) {
	for {
		select {
		case <-done:
			return
		case <-l.kick:
			l.once(true)
		}
	}
}

// skinFor is the skin id /skin hands the pet for a role's pack ("" = the role's built-in skin), starting the
// conversion when the pack has none yet.
func (l *petLayout) skinFor(pack string) string {
	if pack == "" || strings.ContainsAny(pack, `/\\:`) || pack == "." || pack == ".." {
		return ""
	}
	if petSkinReady(l.paths, pack) {
		return petSkinPrefix + pack
	}
	l.mu.Lock()
	_, failed := l.failed[pack]
	busy := l.preparing[pack]
	if !busy && !failed {
		l.preparing[pack] = true
	}
	l.mu.Unlock()
	if busy || failed {
		return ""
	}
	go func() {
		defer func() {
			l.mu.Lock()
			delete(l.preparing, pack)
			l.mu.Unlock()
		}()
		info, err := core.LoadPetPackDir(filepath.Join(l.paths.packs, pack))
		if err == nil {
			l.relay.logf("pack %s: making a desktop skin from %d actions (%s)", pack, len(info.Actions), info.Format)
			err = petPrepareClips(l.ctx, l.paths, info, l.relay.logf)
		}
		if err != nil && l.ctx.Err() == nil {
			l.fail(pack, err)
		}
	}()
	return ""
}

func (l *petLayout) fail(pack string, err error) {
	l.mu.Lock()
	_, seen := l.failed[pack]
	l.failed[pack] = err.Error()
	l.mu.Unlock()
	if !seen {
		l.relay.logf("pack %s cannot be worn, the role keeps its built-in look: %v", pack, err)
		writePetPackStatus(l.paths, petPackStatus{Pack: pack, State: "failed", Error: err.Error()})
	}
}

// once lays the pets out for the current bindings. live means the pet is up: then it reloads the pet when
// the kinds changed.
func (l *petLayout) once(live bool) {
	r := l.relay
	r.mu.Lock()
	roles := make([]string, 0, len(r.bound))
	packs := map[string]string{}
	for role, pack := range r.bound {
		roles = append(roles, role)
		packs[role] = pack
	}
	r.mu.Unlock()

	plan := petPlan(roles, packs)
	var conf struct {
		Animations       map[string]any `json:"animations"`
		AnimationWeights map[string]any `json:"animationWeights"`
	}
	if l.paths.bundled == "" || readJSONC(filepath.Join(l.paths.bundled, "assets", "config.jsonc"), &conf) != nil {
		r.logf("pet kinds: cannot read the bundled animation table; extra roles share the main pet")
		for i := range plan {
			plan[i].Pet = "main"
		}
	}
	changed, err := petWriteKinds(l.paths, petKindFiles(plan, readPetMainLook(l.paths), conf.Animations, conf.AnimationWeights))
	if err != nil {
		r.logf("write pet kinds: %v", err)
	}
	assign := map[string]petAssign{}
	for _, a := range plan {
		assign[a.Role] = a
		_ = l.skinFor(a.Pack) // start converting an imported pack early
		r.logf("pet %s ← %s", a.Pet, a.Role)
	}
	r.mu.Lock()
	r.assign = assign
	r.mu.Unlock()
	if !live {
		return
	}
	if changed {
		if err := l.pet.do("POST", "/reload", nil); err != nil {
			r.logf("reload pet: %v", err)
		}
	}
	r.resend()
}
