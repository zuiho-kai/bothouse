package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/chenhg5/cc-connect/core"
	"github.com/tidwall/pretty"
)

// One role, one desktop pet (#549). The first bound role keeps the pet's own "main"; every other bound
// role gets its own pet as one of the pet's "kinds" (docs/CONFIG.md「方式四：额外宠物」):
// $DSH_HOME/dsh-pet/pet/<pet id>-config.json with the stock animation table and one instance. A kind has no
// clips of its own, so the pet dresses it in a skin (src/host/skins.ts): it asks /skin?pet=<pet id> which
// role it is and wears that role's built-in skin (assets/roles/skins.json aliases).

// petKindPrefix marks the kind files bothouse owns (pet ids are bh-<role key>); any other file under pet/
// is the user's and is left alone.
const petKindPrefix = "bh-"

// ---- where the pet's files live ----

type petLayoutPaths struct {
	petDir   string // $DSH_HOME/dsh-pet/pet (the pet's kind directory)
	mainConf string // $DSH_HOME/dsh-pet/main-config.jsonc
	bundled  string // the installed pet package root ("" when unknown)
}

func newPetLayoutPaths(dataDir, bundled string) petLayoutPaths {
	home := filepath.Join(dshPetHome(), "dsh-pet")
	return petLayoutPaths{
		petDir:   filepath.Join(home, "pet"),
		mainConf: filepath.Join(home, "main-config.jsonc"),
		bundled:  bundled,
	}
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

// ---- the layout: which role is which pet ----

// petAssign is one bound role on the desktop.
type petAssign struct {
	Role string // role key, bridge:<project> or dsh:<id>
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
func petPlan(roles []string) []petAssign {
	sorted := append([]string(nil), roles...)
	sort.Strings(sorted)
	out := make([]petAssign, 0, len(sorted))
	for i, role := range sorted {
		a := petAssign{Role: role, Pet: "main"}
		if i > 0 {
			a.Pet = petInstanceID(role)
		}
		out = append(out, a)
	}
	return out
}

// petDefaultSize is a new extra pet's size; the user turns it per pet with right-click 大小.
const petDefaultSize = 260 // 用户 22:59「默认尺寸调小（参照线上旧桌宠 260）」

// petKept is what the user changed on an extra pet (size, position) and a rewrite must keep.
type petKept struct {
	Size     int            `json:"size"`
	Position map[string]any `json:"position"`
}

// readPetKept reads size/position of bothouse's existing kind files (pet id → values).
func readPetKept(p petLayoutPaths) map[string]petKept {
	out := map[string]petKept{}
	entries, _ := os.ReadDir(p.petDir)
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasPrefix(n, petKindPrefix) || !strings.HasSuffix(n, "-config.json") {
			continue
		}
		var conf struct {
			Pets []struct {
				ID string `json:"id"`
				petKept
			} `json:"pets"`
		}
		if readJSONC(filepath.Join(p.petDir, n), &conf) == nil {
			for _, pet := range conf.Pets {
				out[pet.ID] = pet.petKept
			}
		}
	}
	return out
}

// petKindFiles renders one kind file per extra pet: the stock animation table (the skin maps every name to
// its clips) and one instance, 260 wide unless the user resized it. New ones line up beside the main pet,
// half a pet apart (the characters fill about the middle half of their 640×360 frames).
func petKindFiles(plan []petAssign, look petMainLook, kept map[string]petKept, anims map[string]any, weights map[string]any) map[string][]byte {
	files := map[string][]byte{}
	slot := 0
	for _, a := range plan {
		if a.Pet == "main" {
			continue
		}
		slot++
		size := petDefaultSize // 用户 22:59「默认尺寸调小（参照线上旧桌宠 260）」
		position := map[string]any{"corner": look.Corner, "marginX": look.MarginX + slot*size/2, "marginY": look.MarginY}
		// The user may have resized or moved this pet (right-click 大小 → /pet-size writes this same file):
		// keep that, only the rest of the file is bothouse's.
		if keep, ok := kept[a.Pet]; ok {
			if keep.Size > 0 {
				size = keep.Size
			}
			if keep.Position != nil {
				position = keep.Position
			}
		}
		conf := map[string]any{
			"_comment": "bothouse 生成（bothouse pet run，一个角色一只桌宠）；这只穿角色自己的形象，手改会被覆盖。",
			"pets": []any{map[string]any{
				// name is the role key without "bridge:": stable, so display names never rewrite the file.
				"id": a.Pet, "name": strings.TrimPrefix(a.Role, "bridge:"), "size": size,
				"balanceEnabled": false, "whisperEnabled": true, "workStatusEnabled": true, "fixedEnabled": false,
				"display":  "desktop",
				"position": position,
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
// again whenever the bound roles change.
type petLayout struct {
	paths petLayoutPaths
	relay *petRelay
	pet   *dshPetClient
	kick  chan struct{}
}

func newPetLayout(paths petLayoutPaths, relay *petRelay, pet *dshPetClient) *petLayout {
	l := &petLayout{paths: paths, relay: relay, pet: pet, kick: make(chan struct{}, 1)}
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

// once lays the pets out for the current bindings. live means the pet is up: then it reloads the pet when
// the kinds changed.
func (l *petLayout) once(live bool) {
	r := l.relay
	r.mu.Lock()
	roles := make([]string, 0, len(r.bound))
	for role := range r.bound {
		roles = append(roles, role)
	}
	r.mu.Unlock()

	plan := petPlan(roles)
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
	changed, err := petWriteKinds(l.paths, petKindFiles(plan, readPetMainLook(l.paths), readPetKept(l.paths), conf.Animations, conf.AnimationWeights))
	if err != nil {
		r.logf("write pet kinds: %v", err)
	}
	assign := map[string]petAssign{}
	for _, a := range plan {
		assign[a.Role] = a
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
