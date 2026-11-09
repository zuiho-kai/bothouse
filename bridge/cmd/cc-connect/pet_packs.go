package main

import (
	"bytes"
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

// One role, one desktop pet (#549). Each bound role gets its own pet instance; a role whose binding names
// an avatar pack (plugin page → 形象包, stored as avatar_pack) shows that pack. The bundled pet only plays
// transparent WebM, so `bothouse pet run` turns a pack into one of the pet's own "kinds"
// (docs/CONFIG.md「方式四：额外宠物」): $DSH_HOME/dsh-pet/pet/bothouse-<pack>-config.json holds the
// animation table and the instances, bothouse-<pack>-animation/ the clips. WebP sprite packs
// (hunmer/aboutme-pets) are encoded to WebM once with ffmpeg, the same command as the pack author's own
// spritesheet_to_video_pet.py.

// petKindPrefix marks the kind files bothouse owns; any other file under pet/ is the user's and is left alone.
const petKindPrefix = "bothouse-"

// petDefaultPack is the kind for extra roles without a pack: the bundled pet's own clips.
const petDefaultPack = "default"

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

// petKindAnimations builds the kind's `animations` and `animationWeights` from a pack. dsh-pet validates
// them as a whole (src/host/config/validate.ts animationsValid): idle/turn/drag/clicks arrays, moves,
// categories, and every events pool non-empty with a balance pool.
func petKindAnimations(actions []core.PetPackAction) (map[string]any, map[string]any) {
	pick := func(state, fallback string) string {
		if id := petMatch(actions, state); id != "" {
			return id
		}
		return fallback
	}
	idle := pick("idle", actions[0].ID)
	working := pick("working", idle)
	thinking := pick("thinking", working)
	celebrate := pick("celebrate", idle)
	failed := pick("error", idle)
	byCategory := func(cat string) []string {
		var out []string
		for _, a := range actions {
			if a.Category == cat {
				out = append(out, a.ID)
			}
		}
		return out
	}
	// events.workStatus tiers: thinking, working, result, waiting, success, error (dsh-pet shared/work-status.ts).
	events := map[string]any{"workStatus": []any{thinking, working, working, thinking, celebrate, failed}}
	balance := byCategory("余额")
	if len(balance) < 6 { // 6 = dsh-pet 的余额档数（assets/config.jsonc events.balance）
		balance = []string{idle}
	}
	events["balance"] = balance
	if speech := petMatch(actions, "speech"); speech != "" {
		events["whisper"] = []string{speech}
	}
	used := map[string]bool{}
	for _, list := range [][]string{{idle, working, thinking, celebrate, failed}, balance} {
		for _, id := range list {
			used[id] = true
		}
	}
	var rest []string
	for _, a := range actions {
		if !used[a.ID] && a.Category != "移动" && a.Category != "拖拽" {
			rest = append(rest, a.ID)
		}
	}
	clicks := byCategory("点击回应")
	if clicks == nil {
		clicks = []string{}
	}
	categories := []any{}
	if len(rest) > 0 {
		categories = append(categories, map[string]any{"id": "动作", "weight": 20, "actions": rest}) // 20 沿用 assets/config.jsonc 的小动作权重
	}
	anims := map[string]any{
		"idle":       []string{idle},
		"turn":       []string{},
		"drag":       []string{},
		"clicks":     clicks,
		"moves":      map[string]any{"default": map[string]any{"minDist": 60, "maxDist": 240, "margin": 20, "leadSec": 2, "tailSec": 2}, "actions": []any{}}, // 沿用 assets/config.jsonc moves.default
		"categories": categories,
		"events":     events,
	}
	// 没有走路片段：move 权重 0，只在原地换动作；idle/turn 沿用 assets/config.jsonc 的 10/5。
	return anims, map[string]any{"idle": 10, "turn": 0, "move": 0}
}

// ---- where the pet's files live ----

type petLayoutPaths struct {
	petDir   string // $DSH_HOME/dsh-pet/pet (the pet's kind directory)
	mainConf string // $DSH_HOME/dsh-pet/main-config.jsonc
	packs    string // bothouse's pack store (<DataDir>/pets, same as GET /api/v1/plugins/pets)
	status   string // <DataDir>/pet/packs: one <pack>.json per conversion, read by the plugin page
	bundled  string // the installed pet package root ("" when unknown)
}

func newPetLayoutPaths(dataDir, bundled string) petLayoutPaths {
	home := filepath.Join(dshPetHome(), "dsh-pet")
	return petLayoutPaths{
		petDir:   filepath.Join(home, "pet"),
		mainConf: filepath.Join(home, "main-config.jsonc"),
		packs:    filepath.Join(dataDir, "pets"),
		status:   filepath.Join(dataDir, "pet", "packs"),
		bundled:  bundled,
	}
}

func (p petLayoutPaths) kind(pack string) string { return petKindPrefix + pack }

func (p petLayoutPaths) animDir(pack string) string {
	return filepath.Join(p.petDir, p.kind(pack)+"-animation")
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

// petClipsReady reports whether every action of the pack has its clip.
func petClipsReady(p petLayoutPaths, pack string, actions []core.PetPackAction) bool {
	dir := p.animDir(pack)
	for _, a := range actions {
		if fi, err := os.Stat(filepath.Join(dir, a.ID+".webm")); err != nil || fi.Size() == 0 {
			return false
		}
	}
	return len(actions) > 0
}

// petPrepareClips fills bothouse-<pack>-animation with <action>.webm: WebM packs are linked or copied,
// WebP sprite packs encoded with ffmpeg. Existing clips are kept, so an interrupted run resumes.
func petPrepareClips(p petLayoutPaths, info core.PetPackInfo, logf func(string, ...any)) error {
	dir := p.animDir(info.ID)
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
	workers := runtime.NumCPU() / 2
	if workers < 1 {
		workers = 1
	}
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for a := range jobs {
				err := petPrepareClip(ffmpeg, info.LocalPath, dir, a)
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
	st.State = "ready"
	writePetPackStatus(p, st)
	logf("pack %s: %d clips ready in %s", info.ID, total, dir)
	return nil
}

func petPrepareClip(ffmpeg, packDir, outDir string, a core.PetPackAction) error {
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
	// Same encode as hunmer/aboutme-pets spritesheet_to_video_pet.py: loop the sheet, crop frame n of the
	// grid, VP9 with alpha. crf 30 + realtime instead of its crf 20 — 实测（本机 2026-11-09，claude 包
	// 「写代码」120 帧 640×360）：crf 20 5.7 s / 1.47 MB，crf 30 realtime 4.5 s / 1.02 MB，260–460 px 的桌宠窗口里看不出差别。
	vf := fmt.Sprintf("crop=%d:%d:x='mod(n\\,%d)*%d':y='floor(n/%d)*%d',format=yuva420p",
		a.FrameWidth, a.FrameHeight, a.Columns, a.FrameWidth, a.Columns, a.FrameHeight)
	fps := fmt.Sprintf("%g", a.FPS)
	args := []string{"-hide_banner", "-nostdin", "-y", "-v", "error",
		"-loop", "1", "-framerate", fps, "-i", src, "-frames:v", fmt.Sprint(a.FrameCount),
		"-vf", vf, "-c:v", "libvpx-vp9", "-auto-alt-ref", "0", "-pix_fmt", "yuva420p",
		"-row-mt", "1", "-b:v", "0", "-crf", "30", "-deadline", "realtime", "-cpu-used", "8",
		"-metadata:s:v:0", "alpha_mode=1", "-f", "webm", tmp}
	cmd := exec.Command(ffmpeg, args...)
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

// petLinkBundled points bothouse-default-animation at the bundled pet's own clips (assets/webm), copying
// them where a directory link is not allowed (Windows without developer mode).
func petLinkBundled(p petLayoutPaths) error {
	if p.bundled == "" {
		return fmt.Errorf("bundled pet location unknown")
	}
	src := filepath.Join(p.bundled, "assets", "webm")
	dst := p.animDir(petDefaultPack)
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	if err := os.MkdirAll(p.petDir, 0o755); err != nil {
		return err
	}
	if os.Symlink(src, dst) == nil {
		return nil
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".webm") {
			if err := copyPetFile(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// ---- the layout: which role is which pet ----

// petAssign is one bound role on the desktop.
type petAssign struct {
	Role string // role key, bridge:<project> or dsh:<id>
	Name string // display name
	Pack string // avatar pack ("" = the bundled look)
	Pet  string // dsh-pet instance id
	Kind string // "main" or bothouse-<pack>
}

// petInstanceID derives the pet id from the role key ("bridge:deep" → "bh-bridge-deep"); dsh-pet ids
// may not hold \ / : or control characters (src/host/config/constants.ts ID_FORBIDDEN) and are at most
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
	id := "bh-" + b.String()
	if r := []rune(id); len(r) > 64 { // MAX_PET_ID_LENGTH
		id = string(r[:64])
	}
	return id
}

// petPlan decides the pets: the first role without a usable pack keeps the existing "main" pet (one
// bound role behaves as before); every other role gets its own instance in its pack's kind, or in
// bothouse-default when it has none. ready says whether a pack's clips are there; a role whose pack is
// still being prepared shows the bundled look until it is.
func petPlan(roles []string, packs, names map[string]string, ready func(pack string) bool) []petAssign {
	sorted := append([]string(nil), roles...)
	sort.Strings(sorted)
	var out []petAssign
	mainTaken := false
	for _, role := range sorted {
		a := petAssign{Role: role, Name: names[role], Pack: packs[role]}
		if a.Name == "" {
			a.Name = role
		}
		if a.Pack != "" && !ready(a.Pack) {
			a.Pack = ""
		}
		switch {
		case a.Pack == "" && !mainTaken:
			a.Pet, a.Kind, mainTaken = "main", "main", true
		case a.Pack == "":
			a.Pet, a.Kind, a.Pack = petInstanceID(role), petKindPrefix+petDefaultPack, petDefaultPack
		default:
			a.Pet, a.Kind = petInstanceID(role), petKindPrefix+a.Pack
		}
		out = append(out, a)
	}
	return out
}

// petKindFiles renders the kind config files for a plan: file name → content. Instances line up beside
// the main pet, half a pet apart (the characters fill about the middle half of the 640×360 frames of
// the aboutme-pets / dsh-pet clips), so they do not cover each other.
func petKindFiles(plan []petAssign, look petMainLook, anims map[string][2]map[string]any) map[string][]byte {
	byKind := map[string][]map[string]any{}
	var kinds []string
	slot := 0
	for _, a := range plan {
		if a.Kind == "main" {
			continue
		}
		slot++
		if _, ok := byKind[a.Kind]; !ok {
			kinds = append(kinds, a.Kind)
		}
		byKind[a.Kind] = append(byKind[a.Kind], map[string]any{
			"id": a.Pet, "name": a.Name, "size": look.Size,
			"balanceEnabled": false, "whisperEnabled": true, "workStatusEnabled": true, "fixedEnabled": false,
			"display":  "desktop",
			"position": map[string]any{"corner": look.Corner, "marginX": look.MarginX + slot*look.Size/2, "marginY": look.MarginY},
		})
	}
	files := map[string][]byte{}
	for _, kind := range kinds {
		pair, ok := anims[strings.TrimPrefix(kind, petKindPrefix)]
		if !ok {
			continue
		}
		conf := map[string]any{
			"_comment":         "bothouse 生成（bothouse pet run，一个角色一只桌宠）；改形象请在 bothouse 插件页给角色选形象包，这里手改会被覆盖。",
			"pets":             byKind[kind],
			"animations":       pair[0],
			"animationWeights": pair[1],
		}
		b, _ := json.MarshalIndent(conf, "", "  ")
		files[kind+"-config.json"] = append(b, '\n')
	}
	return files
}

// petWriteKinds writes the kind files and removes bothouse's stale ones; it reports whether anything
// changed (then the pet has to reload). Clip directories stay: they are the conversion cache.
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

// petLayout keeps the pet's kinds in step with the role bindings: it runs once before the pet starts
// and again whenever a role, its pack or a pack's clips change.
type petLayout struct {
	paths petLayoutPaths
	relay *petRelay
	pet   *dshPetClient
	kick  chan struct{}

	mu        sync.Mutex
	preparing map[string]bool
	failed    map[string]string // pack → why it cannot be used (shown in the log and the plugin page)
}

func newPetLayout(paths petLayoutPaths, relay *petRelay, pet *dshPetClient) *petLayout {
	l := &petLayout{paths: paths, relay: relay, pet: pet, kick: make(chan struct{}, 1),
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

// packAnims loads a pack and its kind animations; ok is false when it cannot be shown yet.
func (l *petLayout) packAnims(pack string) (anims [2]map[string]any, ready bool) {
	if pack == petDefaultPack {
		var conf struct {
			Animations       map[string]any `json:"animations"`
			AnimationWeights map[string]any `json:"animationWeights"`
		}
		if l.paths.bundled == "" || readJSONC(filepath.Join(l.paths.bundled, "assets", "config.jsonc"), &conf) != nil || petLinkBundled(l.paths) != nil {
			return anims, false
		}
		return [2]map[string]any{conf.Animations, conf.AnimationWeights}, true
	}
	if strings.ContainsAny(pack, `/\:`) || pack == "." || pack == ".." {
		return anims, false
	}
	info, err := core.LoadPetPackDir(filepath.Join(l.paths.packs, pack))
	if err != nil {
		l.fail(pack, err)
		return anims, false
	}
	a, w := petKindAnimations(info.Actions)
	anims = [2]map[string]any{a, w}
	if petClipsReady(l.paths, pack, info.Actions) {
		return anims, true
	}
	l.mu.Lock()
	busy := l.preparing[pack]
	_, failed := l.failed[pack]
	if !busy && !failed {
		l.preparing[pack] = true
	}
	l.mu.Unlock()
	if !busy && !failed {
		l.relay.logf("pack %s: preparing %d desktop clips (%s)", pack, len(info.Actions), info.Format)
		go func() {
			err := petPrepareClips(l.paths, info, l.relay.logf)
			l.mu.Lock()
			delete(l.preparing, pack)
			l.mu.Unlock()
			if err != nil {
				l.fail(pack, err)
				return
			}
			l.request()
		}()
	}
	return anims, false
}

func (l *petLayout) fail(pack string, err error) {
	l.mu.Lock()
	_, seen := l.failed[pack]
	l.failed[pack] = err.Error()
	l.mu.Unlock()
	if !seen {
		l.relay.logf("pack %s cannot be shown, the role keeps the default look: %v", pack, err)
		writePetPackStatus(l.paths, petPackStatus{Pack: pack, State: "failed", Error: err.Error()})
	}
}

// once lays the pets out for the current bindings. live means the pet is up: then it reloads the pet when
// the kinds changed and hides or restores the main pet.
func (l *petLayout) once(live bool) {
	r := l.relay
	r.mu.Lock()
	roles := make([]string, 0, len(r.bound))
	packs := map[string]string{}
	names := map[string]string{}
	for role, pack := range r.bound {
		roles = append(roles, role)
		packs[role] = pack
		names[role] = r.names[role]
	}
	r.mu.Unlock()

	anims := map[string][2]map[string]any{}
	ready := func(pack string) bool {
		if _, ok := anims[pack]; ok {
			return true
		}
		a, ok := l.packAnims(pack)
		if ok {
			anims[pack] = a
		}
		return ok
	}
	plan := petPlan(roles, packs, names, ready)
	for i, a := range plan {
		if a.Pack == petDefaultPack && !ready(petDefaultPack) {
			plan[i].Pet, plan[i].Kind = "main", "main" // no bundled clips to copy: share the main pet
		}
	}
	look := readPetMainLook(l.paths)
	changed, err := petWriteKinds(l.paths, petKindFiles(plan, look, anims))
	if err != nil {
		r.logf("write pet kinds: %v", err)
	}
	assign := map[string]petAssign{}
	hasMain := false
	for _, a := range plan {
		assign[a.Role] = a
		hasMain = hasMain || a.Pet == "main"
		r.logf("pet %s ← %s (%s)", a.Pet, a.Role, a.Kind)
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
	l.mainDisplay(len(plan) > 0 && !hasMain, look)
	r.resend()
}

// mainDisplay hides the main pet while every bound role has a pet of its own, and puts its display back
// (the value it had before, kept in <DataDir>/pet/main-display.json) once a role uses it again.
func (l *petLayout) mainDisplay(hide bool, look petMainLook) {
	saved := filepath.Join(filepath.Dir(l.paths.status), "main-display.json")
	var prev struct {
		Display string `json:"display"`
	}
	hidden := readJSONC(saved, &prev) == nil && prev.Display != ""
	switch {
	case hide && !hidden && look.Display != "none":
		b, _ := json.Marshal(map[string]string{"display": look.Display})
		if err := os.WriteFile(saved, b, 0o644); err != nil {
			l.relay.logf("main pet display: %v", err)
			return
		}
		if err := l.pet.do("POST", "/pet-display", map[string]string{"id": "main", "display": "none"}); err != nil {
			l.relay.logf("hide main pet: %v", err)
		}
	case !hide && hidden:
		if err := l.pet.do("POST", "/pet-display", map[string]string{"id": "main", "display": prev.Display}); err != nil {
			l.relay.logf("restore main pet: %v", err)
			return
		}
		_ = os.Remove(saved)
	}
}
