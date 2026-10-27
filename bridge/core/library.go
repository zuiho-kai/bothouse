package core

// Persona and avatar library, organised in packs (docs/persona-packs.md).
//
//	<data_dir>/library/
//	  packs/<id>/manifest.json            one installed pack: id, name, author, version, license
//	  packs/<id>/personas/<slug>.md       one persona: front matter (name, intro, avatar) + the full text
//	  packs/<id>/avatars/<slug>.<ext>     one picture (png, jpg, jpeg, webp, gif)
//	  packs/mine/                         the user's own pack: everything made or edited in the UI
//	  state.json                          disabled packs, hidden items
//	  trash/<personas|avatars>/           the last deleted copy of each slug, for "undo"
//	  staging/<id>/                       a pack being previewed before install
//
// The default pack is built into the program (persona_presets.go + web/public/avatars) and is
// read-only. Reading the library merges every enabled pack by slug: mine > installed packs (by id)
// > default. Editing a default or installed item saves a copy in "mine"; "reset" removes that copy.
// Items of other packs are never deleted, only hidden (and can be shown again).

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	LibraryDefaultPack = "default"
	LibraryMinePack    = "mine"

	// Size limits of what the library accepts. 来源：用户没给数字，派活原话允许取常见值，交付时列为「我加的设定」。
	libraryMaxImage   = 2 << 20  // 来源：常见头像上传上限 2 MiB（我加的设定）
	libraryMaxPersona = 64 << 10 // 来源：常见值 64 KiB，现有人设最长约 1 KiB（我加的设定）
	libraryMaxZip     = 20 << 20 // 来源：常见值 20 MiB，约 12 张 2 MiB 图再留余量（我加的设定）
	libraryMaxUnzip   = 50 << 20 // 来源：常见值 50 MiB，防 zip 炸弹（我加的设定）
	librarySlugMax    = 32       // 来源：沿用 dsh/collab/roster.mjs MAX_NAME = 32（slug 也当成员 id 用）
	libraryRandBytes  = 3        // 来源：沿用 dsh/collab/roster.mjs newId 的 6 位随机后缀
)

var librarySlugRE = regexp.MustCompile(fmt.Sprintf(`^[a-z0-9][a-z0-9_-]{0,%d}$`, librarySlugMax-1))

// LibrarySlugOK: a valid persona / avatar / pack id (also a safe file name).
func LibrarySlugOK(s string) bool { return librarySlugRE.MatchString(s) }

var libraryImageExt = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}

var libraryImageExts = []string{".png", ".jpg", ".jpeg", ".webp", ".gif"}

func libraryExtOK(ext string) bool { return has(libraryImageExts, strings.ToLower(ext)) }

type PackManifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author,omitempty"`
	Version     string `json:"version,omitempty"`
	License     string `json:"license,omitempty"`
	Description string `json:"description,omitempty"`
}

type LibraryPack struct {
	PackManifest
	Enabled  bool `json:"enabled"`
	Builtin  bool `json:"builtin"`  // the default pack
	Writable bool `json:"writable"` // "mine"
	Personas int  `json:"personas"`
	Avatars  int  `json:"avatars"`
}

type LibraryPersona struct {
	Slug      string   `json:"slug"`
	Name      string   `json:"name"`
	Intro     string   `json:"intro"`
	Avatar    string   `json:"avatar,omitempty"`
	Text      string   `json:"text"`
	Pack      string   `json:"pack"`                // the pack the shown version comes from
	Overrides string   `json:"overrides,omitempty"` // the pack whose same-slug item it replaces ("reset" brings that back)
	Hidden    bool     `json:"hidden,omitempty"`
	InUse     []string `json:"in_use,omitempty"` // display names of the roles using it
}

type LibraryAvatar struct {
	Slug      string   `json:"slug"`
	URL       string   `json:"url"`
	Pack      string   `json:"pack"`
	Overrides string   `json:"overrides,omitempty"`
	Hidden    bool     `json:"hidden,omitempty"`
	InUse     []string `json:"in_use,omitempty"`
}

type Library struct {
	Personas []LibraryPersona `json:"personas"`
	Avatars  []LibraryAvatar  `json:"avatars"`
	Packs    []LibraryPack    `json:"packs"`
}

type libraryState struct {
	Disabled       []string `json:"disabled,omitempty"`
	HiddenPersonas []string `json:"hidden_personas,omitempty"`
	HiddenAvatars  []string `json:"hidden_avatars,omitempty"`
}

func libraryDir(dataDir string) string { return filepath.Join(dataDir, "library") }
func libraryPackDir(dataDir, id string) string {
	return filepath.Join(libraryDir(dataDir), "packs", id)
}

func loadLibraryState(dataDir string) libraryState {
	var s libraryState
	readJSONFile(filepath.Join(libraryDir(dataDir), "state.json"), &s)
	return s
}

func saveLibraryState(dataDir string, s libraryState) error {
	return writeJSONFile(filepath.Join(libraryDir(dataDir), "state.json"), s, 0o644)
}

func has(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func without(list []string, s string) []string {
	out := []string{}
	for _, x := range list {
		if x != s {
			out = append(out, x)
		}
	}
	return out
}

// ── persona files ─────────────────────────────────────────────

// ParsePersonaFile reads a persona file: an optional front matter block (--- / key: value / ---)
// with name, intro and avatar, then the full text. No front matter = the whole file is the text.
func ParsePersonaFile(b []byte) (name, intro, avatar, text string) {
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	s = strings.TrimPrefix(s, "\ufeff")
	if rest, ok := strings.CutPrefix(s, "---\n"); ok {
		if head, body, ok := strings.Cut(rest, "\n---\n"); ok {
			for _, line := range strings.Split(head, "\n") {
				k, v, ok := strings.Cut(line, ":")
				if !ok {
					continue
				}
				v = strings.Trim(strings.TrimSpace(v), `"'`)
				switch strings.TrimSpace(k) {
				case "name":
					name = v
				case "intro":
					intro = v
				case "avatar":
					avatar = v
				}
			}
			s = strings.TrimPrefix(body, "\n")
		}
	}
	return name, intro, avatar, s
}

// FormatPersonaFile is the inverse of ParsePersonaFile.
func FormatPersonaFile(name, intro, avatar, text string) []byte {
	one := func(v string) string { return strings.Join(strings.Fields(v), " ") }
	var b strings.Builder
	b.WriteString("---\nname: " + one(name) + "\nintro: " + one(intro) + "\n")
	if avatar != "" {
		b.WriteString("avatar: " + one(avatar) + "\n")
	}
	b.WriteString("---\n")
	b.WriteString(strings.TrimRight(strings.ReplaceAll(text, "\r\n", "\n"), "\n") + "\n")
	return []byte(b.String())
}

// ── reading packs ─────────────────────────────────────────────

type packContent struct {
	manifest PackManifest
	personas map[string]LibraryPersona
	avatars  map[string]string // slug → file path
}

// readPackDir reads one pack folder. Files that are not a valid persona or picture are skipped.
func readPackDir(dir string) packContent {
	pc := packContent{personas: map[string]LibraryPersona{}, avatars: map[string]string{}}
	readJSONFile(filepath.Join(dir, "manifest.json"), &pc.manifest)
	if es, err := os.ReadDir(filepath.Join(dir, "personas")); err == nil {
		for _, e := range es {
			slug, ok := strings.CutSuffix(e.Name(), ".md")
			if !ok || e.IsDir() || !LibrarySlugOK(slug) {
				continue
			}
			b, err := os.ReadFile(filepath.Join(dir, "personas", e.Name()))
			if err != nil || len(b) > libraryMaxPersona {
				continue
			}
			n, in, av, t := ParsePersonaFile(b)
			if n == "" {
				n = slug
			}
			pc.personas[slug] = LibraryPersona{Slug: slug, Name: n, Intro: in, Avatar: av, Text: t}
		}
	}
	if es, err := os.ReadDir(filepath.Join(dir, "avatars")); err == nil {
		for _, e := range es {
			ext := filepath.Ext(e.Name())
			slug := strings.TrimSuffix(e.Name(), ext)
			if e.IsDir() || !libraryExtOK(ext) || !LibrarySlugOK(slug) {
				continue
			}
			pc.avatars[slug] = filepath.Join(dir, "avatars", e.Name())
		}
	}
	return pc
}

// installedPackIDs: the pack folders under library/packs, "mine" first, the rest by id.
func installedPackIDs(dataDir string) []string {
	es, _ := os.ReadDir(filepath.Join(libraryDir(dataDir), "packs"))
	ids := []string{}
	mine := false
	for _, e := range es {
		if !e.IsDir() || !LibrarySlugOK(e.Name()) || e.Name() == LibraryDefaultPack {
			continue
		}
		if e.Name() == LibraryMinePack {
			mine = true
			continue
		}
		ids = append(ids, e.Name())
	}
	sort.Strings(ids)
	if mine {
		ids = append([]string{LibraryMinePack}, ids...)
	}
	return ids
}

func defaultAvatarBytes(slug string) ([]byte, bool) {
	if webAssetsFS == nil || !IsAvatar(slug) {
		return nil, false
	}
	b, err := fs.ReadFile(webAssetsFS, "avatars/"+slug+".png")
	return b, err == nil
}

// avatarURL: where the web page loads a library picture; v changes when the file does (cache).
func avatarURL(slug, pack, file string) string {
	v := pack
	if file != "" {
		if st, err := os.Stat(file); err == nil {
			v += fmt.Sprintf("-%d", st.ModTime().Unix())
		}
	}
	return "/api/v1/library/avatar-image/" + slug + "?v=" + v
}

// LoadLibrary merges the enabled packs (mine > installed by id > default). state supplies who uses
// what (the roles' persona / avatar slugs); lang picks the default pack's language.
func LoadLibrary(dataDir, lang string, state SetupState) Library {
	st := loadLibraryState(dataDir)
	lib := Library{Personas: []LibraryPersona{}, Avatars: []LibraryAvatar{}}
	ps := map[string]LibraryPersona{}
	as := map[string]LibraryAvatar{}
	pOrder, aOrder := []string{}, []string{}
	// lowest priority first; a higher pack overwrites and records what it replaced
	putP := func(p LibraryPersona) {
		if old, ok := ps[p.Slug]; ok {
			p.Overrides = old.Pack
		} else {
			pOrder = append(pOrder, p.Slug)
		}
		ps[p.Slug] = p
	}
	putA := func(a LibraryAvatar) {
		if old, ok := as[a.Slug]; ok {
			a.Overrides = old.Pack
		} else {
			aOrder = append(aOrder, a.Slug)
		}
		as[a.Slug] = a
	}
	def := LibraryPack{PackManifest: PackManifest{ID: LibraryDefaultPack, Name: tr3(lang, "默认包", "デフォルトパック", "Default pack"),
		Author: "bothouse", License: "MIT"}, Builtin: true, Enabled: !has(st.Disabled, LibraryDefaultPack),
		Personas: len(personaPresetsZH), Avatars: len(AvatarLibrary)}
	if def.Enabled {
		for _, p := range PersonaPresets(lang) {
			putP(LibraryPersona{Slug: p.ID, Name: p.Name, Intro: p.Intro, Avatar: p.Avatar, Text: p.Text, Pack: LibraryDefaultPack})
		}
		for _, a := range AvatarLibrary {
			putA(LibraryAvatar{Slug: a, URL: avatarURL(a, LibraryDefaultPack, ""), Pack: LibraryDefaultPack})
		}
	}
	packs := []LibraryPack{def}
	ids := installedPackIDs(dataDir)
	// installed packs by id from last to first, then mine last so it wins
	for i := len(ids) - 1; i >= 0; i-- {
		id := ids[i]
		pc := readPackDir(libraryPackDir(dataDir, id))
		m := pc.manifest
		m.ID = id
		if id == LibraryMinePack {
			m.Name = tr3(lang, "我的", "マイパック", "Mine")
		} else if m.Name == "" {
			m.Name = id
		}
		lp := LibraryPack{PackManifest: m, Writable: id == LibraryMinePack, Enabled: !has(st.Disabled, id),
			Personas: len(pc.personas), Avatars: len(pc.avatars)}
		packs = append(packs, lp)
		if !lp.Enabled {
			continue
		}
		for _, slug := range sortedKeys(pc.personas) {
			p := pc.personas[slug]
			p.Pack = id
			putP(p)
		}
		for _, slug := range sortedKeys(pc.avatars) {
			putA(LibraryAvatar{Slug: slug, URL: avatarURL(slug, id, pc.avatars[slug]), Pack: id})
		}
	}
	sort.SliceStable(packs, func(i, j int) bool { return packRank(packs[i]) < packRank(packs[j]) })
	lib.Packs = packs
	usesP, usesA := libraryUses(state)
	for _, s := range pOrder {
		p := ps[s]
		p.Hidden, p.InUse = has(st.HiddenPersonas, s), usesP[s]
		lib.Personas = append(lib.Personas, p)
	}
	for _, s := range aOrder {
		a := as[s]
		a.Hidden, a.InUse = has(st.HiddenAvatars, s), usesA[s]
		lib.Avatars = append(lib.Avatars, a)
	}
	return lib
}

// packRank orders the pack list: default, mine, then installed packs by id.
func packRank(p LibraryPack) string {
	switch p.ID {
	case LibraryDefaultPack:
		return "0"
	case LibraryMinePack:
		return "1"
	}
	return "2" + p.ID
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// libraryUses: slug → names of the roles (wizard team, every platform) that use it.
func libraryUses(state SetupState) (personas, avatars map[string][]string) {
	personas, avatars = map[string][]string{}, map[string][]string{}
	for _, t := range append(append([]SetupTeamEntry{}, state.Team...), state.CloudWebTeam...) {
		name := t.Name
		if name == "" {
			name = t.Project
		}
		if t.Persona != "" && !has(personas[t.Persona], name) {
			personas[t.Persona] = append(personas[t.Persona], name)
		}
		if t.Avatar != "" && !has(avatars[t.Avatar], name) {
			avatars[t.Avatar] = append(avatars[t.Avatar], name)
		}
	}
	return personas, avatars
}

// LibraryAvatarImage returns a picture by slug from the highest enabled pack that has it (hidden
// ones too: a role may still use them), and that pack's id.
func LibraryAvatarImage(dataDir, slug string) (data []byte, pack string, ok bool) {
	if !LibrarySlugOK(slug) {
		return nil, "", false
	}
	st := loadLibraryState(dataDir)
	for _, id := range installedPackIDs(dataDir) {
		if has(st.Disabled, id) {
			continue
		}
		if f, found := readPackDir(libraryPackDir(dataDir, id)).avatars[slug]; found {
			if b, err := os.ReadFile(f); err == nil && len(b) <= libraryMaxImage {
				return b, id, true
			}
		}
	}
	if has(st.Disabled, LibraryDefaultPack) {
		return nil, "", false
	}
	b, found := defaultAvatarBytes(slug)
	return b, LibraryDefaultPack, found
}

// AvatarDataURI is the picture as a data: URI (Discord's PATCH /users/@me avatar field).
func AvatarDataURI(b []byte) string {
	return "data:" + http.DetectContentType(b) + ";base64," + base64.StdEncoding.EncodeToString(b)
}

// ── editing "mine" ────────────────────────────────────────────

func ensureMinePack(dataDir string) (string, error) {
	dir := libraryPackDir(dataDir, LibraryMinePack)
	for _, sub := range []string{"personas", "avatars"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return "", err
		}
	}
	mf := filepath.Join(dir, "manifest.json")
	if _, err := os.Stat(mf); err != nil {
		if err := writeJSONFile(mf, PackManifest{ID: LibraryMinePack, Name: "Mine"}, 0o644); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// SaveLibraryPersona writes p into "mine" (a copy when slug is another pack's item).
func SaveLibraryPersona(dataDir string, p LibraryPersona) error {
	if !LibrarySlugOK(p.Slug) {
		return fmt.Errorf("invalid slug %q (a-z, 0-9, - and _, up to %d)", p.Slug, librarySlugMax)
	}
	if strings.TrimSpace(p.Name) == "" {
		return errors.New("name required")
	}
	if p.Avatar != "" && !LibrarySlugOK(p.Avatar) {
		return fmt.Errorf("invalid avatar %q", p.Avatar)
	}
	b := FormatPersonaFile(p.Name, p.Intro, p.Avatar, p.Text)
	if len(b) > libraryMaxPersona {
		return fmt.Errorf("persona is larger than %d KiB", libraryMaxPersona>>10)
	}
	dir, err := ensureMinePack(dataDir)
	if err != nil {
		return err
	}
	if err := AtomicWriteFile(filepath.Join(dir, "personas", p.Slug+".md"), b, 0o644); err != nil {
		return err
	}
	st := loadLibraryState(dataDir)
	st.HiddenPersonas = without(st.HiddenPersonas, p.Slug)
	return saveLibraryState(dataDir, st)
}

// CheckImage returns the file extension for an accepted picture (png, jpeg, webp, gif under the size limit).
func CheckImage(b []byte) (string, error) {
	if len(b) == 0 {
		return "", errors.New("empty file")
	}
	if len(b) > libraryMaxImage {
		return "", fmt.Errorf("picture is larger than %d MiB", libraryMaxImage>>20)
	}
	ext, ok := libraryImageExt[http.DetectContentType(b)]
	if !ok {
		return "", errors.New("only png, jpeg, webp and gif pictures are accepted")
	}
	return ext, nil
}

// SaveLibraryAvatar writes a picture into "mine" under slug (replacing any other format of it).
func SaveLibraryAvatar(dataDir, slug string, b []byte) error {
	if !LibrarySlugOK(slug) {
		return fmt.Errorf("invalid slug %q (a-z, 0-9, - and _, up to %d)", slug, librarySlugMax)
	}
	ext, err := CheckImage(b)
	if err != nil {
		return err
	}
	dir, err := ensureMinePack(dataDir)
	if err != nil {
		return err
	}
	removeAvatarFiles(filepath.Join(dir, "avatars"), slug)
	if err := AtomicWriteFile(filepath.Join(dir, "avatars", slug+ext), b, 0o644); err != nil {
		return err
	}
	st := loadLibraryState(dataDir)
	st.HiddenAvatars = without(st.HiddenAvatars, slug)
	return saveLibraryState(dataDir, st)
}

func removeAvatarFiles(dir, slug string) {
	for _, ext := range libraryImageExts {
		_ = os.Remove(filepath.Join(dir, slug+ext))
	}
}

// mineFile: the file of slug in "mine" ("" = none). kind is "personas" or "avatars".
func mineFile(dataDir, kind, slug string) string {
	pc := readPackDir(libraryPackDir(dataDir, LibraryMinePack))
	if kind == "personas" {
		if _, ok := pc.personas[slug]; ok {
			return filepath.Join(libraryPackDir(dataDir, LibraryMinePack), "personas", slug+".md")
		}
		return ""
	}
	return pc.avatars[slug]
}

func toTrash(dataDir, kind, file string) error {
	dir := filepath.Join(libraryDir(dataDir), "trash", kind)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	base := filepath.Base(file)
	if kind == "avatars" {
		removeAvatarFiles(dir, strings.TrimSuffix(base, filepath.Ext(base)))
	}
	return os.Rename(file, filepath.Join(dir, base))
}

func libraryKindOK(kind string) bool { return kind == "personas" || kind == "avatars" }

// libraryItem: the pack the shown version of slug comes from and the pack it overrides.
func libraryItem(lib Library, kind, slug string) (pack, over string, found bool) {
	if kind == "personas" {
		for _, p := range lib.Personas {
			if p.Slug == slug {
				return p.Pack, p.Overrides, true
			}
		}
		return "", "", false
	}
	for _, a := range lib.Avatars {
		if a.Slug == slug {
			return a.Pack, a.Overrides, true
		}
	}
	return "", "", false
}

// DeleteLibraryItem: an item only in "mine" goes to the trash ("deleted"); anything another pack
// provides is hidden instead ("hidden"; a "mine" copy of it stays). kind: personas | avatars.
func DeleteLibraryItem(dataDir, lang, kind, slug string) (string, error) {
	if !libraryKindOK(kind) {
		return "", fmt.Errorf("unknown kind %q", kind)
	}
	pack, over, found := libraryItem(LoadLibrary(dataDir, lang, SetupState{}), kind, slug)
	if !found {
		return "", fmt.Errorf("%s %q not found", kind, slug)
	}
	if pack == LibraryMinePack && over == "" {
		return "deleted", toTrash(dataDir, kind, mineFile(dataDir, kind, slug))
	}
	st := loadLibraryState(dataDir)
	if kind == "personas" && !has(st.HiddenPersonas, slug) {
		st.HiddenPersonas = append(st.HiddenPersonas, slug)
	}
	if kind == "avatars" && !has(st.HiddenAvatars, slug) {
		st.HiddenAvatars = append(st.HiddenAvatars, slug)
	}
	return "hidden", saveLibraryState(dataDir, st)
}

// ResetLibraryItem removes the "mine" copy of another pack's item (to the trash, so undo works).
func ResetLibraryItem(dataDir, lang, kind, slug string) error {
	if !libraryKindOK(kind) {
		return fmt.Errorf("unknown kind %q", kind)
	}
	pack, over, _ := libraryItem(LoadLibrary(dataDir, lang, SetupState{}), kind, slug)
	if pack != LibraryMinePack || over == "" {
		return fmt.Errorf("%s %q has no edited copy", kind, slug)
	}
	return toTrash(dataDir, kind, mineFile(dataDir, kind, slug))
}

// UndoLibraryItem undoes a delete / reset (the trashed copy comes back into "mine") and shows a
// hidden item again.
func UndoLibraryItem(dataDir, kind, slug string) error {
	if !LibrarySlugOK(slug) || !libraryKindOK(kind) {
		return errors.New("invalid item")
	}
	tdir := filepath.Join(libraryDir(dataDir), "trash", kind)
	es, _ := os.ReadDir(tdir)
	for _, e := range es {
		if strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())) != slug {
			continue
		}
		dir, err := ensureMinePack(dataDir)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Join(dir, kind), 0o755); err != nil {
			return err
		}
		if kind == "avatars" {
			removeAvatarFiles(filepath.Join(dir, kind), slug)
		}
		if err := os.Rename(filepath.Join(tdir, e.Name()), filepath.Join(dir, kind, e.Name())); err != nil {
			return err
		}
		break
	}
	st := loadLibraryState(dataDir)
	if kind == "personas" {
		st.HiddenPersonas = without(st.HiddenPersonas, slug)
	} else {
		st.HiddenAvatars = without(st.HiddenAvatars, slug)
	}
	return saveLibraryState(dataDir, st)
}

var slugCleanRE = regexp.MustCompile(`[^a-z0-9]+`)

// NewLibrarySlug: a free slug for a new item, from the name when it has a-z/0-9, else a random one.
func NewLibrarySlug(lib Library, kind, name string) string {
	taken := func(s string) bool { _, _, ok := libraryItem(lib, kind, s); return ok }
	suffix := 1 + 2*libraryRandBytes // "-" + hex
	base := strings.Trim(slugCleanRE.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(base) > librarySlugMax-suffix {
		base = strings.Trim(base[:librarySlugMax-suffix], "-")
	}
	if base == "" || !LibrarySlugOK(base) {
		base = "p"
		if kind == "avatars" {
			base = "a"
		}
	} else if !taken(base) {
		return base
	}
	for {
		if s := base + "-" + randHex(libraryRandBytes); !taken(s) {
			return s
		}
	}
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ── persona edits reach the roles using it ───────────────────

// ApplyPersonaToRoles rewrites the persona of every wizard role that uses slug: the part above the
// wizard's sections (<!-- conest:… -->: reply language, team, tools, …) is replaced by text, the
// sections stay. A persona file without wizard sections was written by hand and is left alone.
func ApplyPersonaToRoles(dataDir string, store WizardStore, slug, text string) (applied, skipped []string) {
	if store == nil {
		return nil, nil
	}
	snap, err := store.Snapshot()
	if err != nil {
		return nil, nil
	}
	st := LoadSetupState(dataDir)
	done := map[string]bool{}
	for _, t := range append(append([]SetupTeamEntry{}, st.Team...), st.CloudWebTeam...) {
		if t.Persona != slug || done[t.Project] {
			continue
		}
		done[t.Project] = true
		name := t.Name
		if name == "" {
			name = t.Project
		}
		p, ok := snap.project(t.Project)
		if !ok || p.WorkDir == "" {
			continue
		}
		path := PersonaFilePath(p.AgentType, p.WorkDir)
		b, err := os.ReadFile(path)
		i := strings.Index(string(b), "<!-- conest:")
		if err != nil || i < 0 {
			skipped = append(skipped, name)
			continue
		}
		roleText := text
		if t.KeepPersonaName {
			lib := LoadLibrary(dataDir, "zh", st)
			english := LoadLibrary(dataDir, "en", st)
			for _, preset := range append(lib.Personas, english.Personas...) {
				if preset.Slug == slug {
					roleText = RenamePersonaIdentity(text, preset.Name, name)
					break
				}
			}
		}
		out := strings.TrimRight(roleText, "\r\n") + "\n\n" + string(b)[i:]
		if AtomicWriteFile(path, []byte(out), 0o644) != nil {
			skipped = append(skipped, name)
			continue
		}
		applied = append(applied, name)
	}
	return applied, skipped
}

// ── packs: preview, install, enable, uninstall, export ───────

// PackPreview is what a pack zip holds, shown before it is installed.
type PackPreview struct {
	Staging  string           `json:"staging"` // pass to install
	Manifest PackManifest     `json:"manifest"`
	Personas []LibraryPersona `json:"personas"`
	Avatars  []LibraryAvatar  `json:"avatars"`             // url = the picture inline (data: URI)
	Replaces string           `json:"replaces,omitempty"`  // version of the same pack already installed
	Skipped  []string         `json:"skipped,omitempty"`   // ignored entries (__MACOSX, .DS_Store)
	Conflict []string         `json:"conflicts,omitempty"` // slugs another pack has too ("mine" still wins)
}

func unsafeZipPath(name string) bool {
	return strings.Contains(name, "\\") || strings.HasPrefix(name, "/") || strings.Contains(name, "..") || strings.Contains(name, ":")
}

// packEntry maps a zip entry name to its place in the pack ("" = ignore). Only manifest.json,
// personas/<slug>.md and avatars/<slug>.<image ext> are allowed; anything else is an error.
func packEntry(name, prefix string) (string, error) {
	if unsafeZipPath(name) {
		return "", fmt.Errorf("unsafe path in zip: %q", name)
	}
	base := path.Base(name)
	if strings.HasPrefix(name, "__MACOSX/") || base == ".DS_Store" {
		return "", nil
	}
	rel, ok := strings.CutPrefix(name, prefix)
	if !ok {
		return "", fmt.Errorf("file outside the pack folder: %q", name)
	}
	if rel == "manifest.json" {
		return rel, nil
	}
	dir, file := path.Split(rel)
	ext := path.Ext(file)
	slug := strings.TrimSuffix(file, ext)
	switch {
	case dir == "personas/" && ext == ".md" && LibrarySlugOK(slug):
		return rel, nil
	case dir == "avatars/" && libraryExtOK(ext) && LibrarySlugOK(slug):
		return rel, nil
	}
	return "", fmt.Errorf("not allowed in a pack: %q (only manifest.json, personas/<slug>.md and avatars/<slug>.png|jpg|webp|gif)", name)
}

// PreviewPack checks a pack zip and unpacks it into staging (nothing is installed yet).
func PreviewPack(dataDir, lang string, zb []byte) (PackPreview, error) {
	// empty lists, not null: the web UI reads both (a pack may have only personas or only avatars)
	pv := PackPreview{Personas: []LibraryPersona{}, Avatars: []LibraryAvatar{}}
	if len(zb) > libraryMaxZip {
		return pv, fmt.Errorf("pack is larger than %d MiB", libraryMaxZip>>20)
	}
	zr, err := zip.NewReader(bytes.NewReader(zb), int64(len(zb)))
	if err != nil {
		return pv, fmt.Errorf("not a zip file: %w", err)
	}
	// manifest.json at the top, or inside one top folder (a zipped folder)
	prefix := ""
	for _, f := range zr.File {
		if path.Base(f.Name) == "manifest.json" && strings.Count(f.Name, "/") <= 1 && !strings.HasPrefix(f.Name, "__MACOSX/") {
			prefix = strings.TrimSuffix(f.Name, "manifest.json")
			break
		}
	}
	files := map[string][]byte{}
	total := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			if unsafeZipPath(f.Name) {
				return pv, fmt.Errorf("unsafe path in zip: %q", f.Name)
			}
			continue
		}
		if !f.Mode().IsRegular() {
			return pv, fmt.Errorf("not a plain file: %q", f.Name)
		}
		rel, err := packEntry(f.Name, prefix)
		if err != nil {
			return pv, err
		}
		if rel == "" {
			pv.Skipped = append(pv.Skipped, f.Name)
			continue
		}
		limit := libraryMaxImage
		if strings.HasSuffix(rel, ".md") || rel == "manifest.json" {
			limit = libraryMaxPersona
		}
		rc, err := f.Open()
		if err != nil {
			return pv, err
		}
		b, err := io.ReadAll(io.LimitReader(rc, int64(limit)+1))
		rc.Close()
		if err != nil {
			return pv, err
		}
		if len(b) > limit {
			return pv, fmt.Errorf("%s is larger than %d KiB", f.Name, limit>>10)
		}
		if strings.HasPrefix(rel, "avatars/") {
			if _, err := CheckImage(b); err != nil {
				return pv, fmt.Errorf("%s: %w", f.Name, err)
			}
		}
		if total += len(b); total > libraryMaxUnzip {
			return pv, fmt.Errorf("pack unpacks to more than %d MiB", libraryMaxUnzip>>20)
		}
		files[rel] = b
	}
	mb, ok := files["manifest.json"]
	if !ok {
		return pv, errors.New("manifest.json missing")
	}
	if err := json.Unmarshal(mb, &pv.Manifest); err != nil {
		return pv, fmt.Errorf("manifest.json: %w", err)
	}
	m := pv.Manifest
	if !LibrarySlugOK(m.ID) || m.ID == LibraryDefaultPack || m.ID == LibraryMinePack {
		return pv, fmt.Errorf("manifest.json: id %q must be a-z, 0-9, - and _ (up to %d) and not %q or %q", m.ID, librarySlugMax, LibraryDefaultPack, LibraryMinePack)
	}
	if strings.TrimSpace(m.Name) == "" || strings.TrimSpace(m.Version) == "" || strings.TrimSpace(m.License) == "" {
		return pv, errors.New("manifest.json: name, version and license are required")
	}
	if len(files) == 1 {
		return pv, errors.New("pack has no personas or avatars")
	}
	pv.Staging = randHex(libraryRandBytes)
	dir := filepath.Join(libraryDir(dataDir), "staging", pv.Staging)
	for rel, b := range files {
		dst := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return pv, err
		}
		if err := AtomicWriteFile(dst, b, 0o644); err != nil {
			return pv, err
		}
	}
	cleanStaging(dataDir, pv.Staging)
	lib := LoadLibrary(dataDir, lang, SetupState{})
	pc := readPackDir(dir)
	for _, s := range sortedKeys(pc.personas) {
		p := pc.personas[s]
		p.Pack = m.ID
		pv.Personas = append(pv.Personas, p)
		if pk, _, ok := libraryItem(lib, "personas", s); ok && pk != m.ID {
			pv.Conflict = append(pv.Conflict, s)
		}
	}
	for _, s := range sortedKeys(pc.avatars) {
		b, _ := os.ReadFile(pc.avatars[s])
		pv.Avatars = append(pv.Avatars, LibraryAvatar{Slug: s, Pack: m.ID, URL: AvatarDataURI(b)})
		if pk, _, ok := libraryItem(lib, "avatars", s); ok && pk != m.ID && !has(pv.Conflict, s) {
			pv.Conflict = append(pv.Conflict, s)
		}
	}
	if old := readPackDir(libraryPackDir(dataDir, m.ID)); old.manifest.ID != "" {
		pv.Replaces = old.manifest.Version
	}
	return pv, nil
}

// cleanStaging drops every other preview: only the latest one can be installed.
func cleanStaging(dataDir, keep string) {
	dir := filepath.Join(libraryDir(dataDir), "staging")
	es, _ := os.ReadDir(dir)
	for _, e := range es {
		if e.Name() != keep {
			_ = os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
}

// InstallPack moves a previewed pack into packs/<id> (replacing an older version) and enables it.
func InstallPack(dataDir, staging string) (PackManifest, error) {
	var m PackManifest
	if staging == "" || strings.Trim(staging, "0123456789abcdef") != "" {
		return m, errors.New("invalid staging id")
	}
	src := filepath.Join(libraryDir(dataDir), "staging", staging)
	if !readJSONFile(filepath.Join(src, "manifest.json"), &m) || !LibrarySlugOK(m.ID) || m.ID == LibraryMinePack || m.ID == LibraryDefaultPack {
		return m, errors.New("preview expired: add the pack again")
	}
	dst := libraryPackDir(dataDir, m.ID)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return m, err
	}
	_ = os.RemoveAll(dst)
	if err := os.Rename(src, dst); err != nil {
		return m, err
	}
	st := loadLibraryState(dataDir)
	st.Disabled = without(st.Disabled, m.ID)
	return m, saveLibraryState(dataDir, st)
}

// SetPackEnabled turns a pack on or off (default and "mine" too: it only stops being merged).
func SetPackEnabled(dataDir, id string, on bool) error {
	if !LibrarySlugOK(id) {
		return errors.New("invalid pack id")
	}
	if id != LibraryDefaultPack {
		if _, err := os.Stat(libraryPackDir(dataDir, id)); err != nil {
			return fmt.Errorf("pack %q is not installed", id)
		}
	}
	st := loadLibraryState(dataDir)
	st.Disabled = without(st.Disabled, id)
	if !on {
		st.Disabled = append(st.Disabled, id)
	}
	return saveLibraryState(dataDir, st)
}

// UninstallPack deletes an installed pack (not the default pack nor "mine").
func UninstallPack(dataDir, id string) error {
	if !LibrarySlugOK(id) || id == LibraryDefaultPack || id == LibraryMinePack {
		return errors.New("only installed packs can be uninstalled")
	}
	dir := libraryPackDir(dataDir, id)
	if _, err := os.Stat(dir); err != nil {
		return fmt.Errorf("pack %q is not installed", id)
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	st := loadLibraryState(dataDir)
	st.Disabled = without(st.Disabled, id)
	return saveLibraryState(dataDir, st)
}

// ExportPack zips a pack that installs again: the given items as the library shows them now
// (any pack), or all of "mine" when both lists are empty. Personas bring their avatar along.
func ExportPack(dataDir, lang string, m PackManifest, personas, avatars []string) ([]byte, error) {
	if !LibrarySlugOK(m.ID) || m.ID == LibraryDefaultPack || m.ID == LibraryMinePack {
		return nil, fmt.Errorf("pack id %q must be a-z, 0-9, - and _ (up to %d) and not %q or %q", m.ID, librarySlugMax, LibraryDefaultPack, LibraryMinePack)
	}
	if strings.TrimSpace(m.Name) == "" || strings.TrimSpace(m.Version) == "" || strings.TrimSpace(m.License) == "" {
		return nil, errors.New("name, version and license are required (the pack cannot be installed again without them)")
	}
	lib := LoadLibrary(dataDir, lang, SetupState{})
	if len(personas) == 0 && len(avatars) == 0 {
		pc := readPackDir(libraryPackDir(dataDir, LibraryMinePack))
		personas, avatars = sortedKeys(pc.personas), sortedKeys(pc.avatars)
	}
	if len(personas) == 0 && len(avatars) == 0 {
		return nil, errors.New("nothing to export: \"Mine\" is empty")
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name string, b []byte) error {
		w, err := zw.Create(name)
		if err == nil {
			_, err = w.Write(b)
		}
		return err
	}
	mb, _ := json.MarshalIndent(m, "", "  ")
	if err := add("manifest.json", append(mb, '\n')); err != nil {
		return nil, err
	}
	wantA := map[string]bool{}
	for _, a := range avatars {
		wantA[a] = true
	}
	for _, s := range personas {
		var p *LibraryPersona
		for i := range lib.Personas {
			if lib.Personas[i].Slug == s {
				p = &lib.Personas[i]
			}
		}
		if p == nil {
			return nil, fmt.Errorf("persona %q not found", s)
		}
		if err := add("personas/"+s+".md", FormatPersonaFile(p.Name, p.Intro, p.Avatar, p.Text)); err != nil {
			return nil, err
		}
		if p.Avatar != "" {
			wantA[p.Avatar] = true
		}
	}
	for _, s := range sortedKeys(wantA) {
		b, _, ok := LibraryAvatarImage(dataDir, s)
		if !ok {
			continue
		}
		ext, err := CheckImage(b)
		if err != nil {
			continue
		}
		if err := add("avatars/"+s+ext, b); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// DownloadPack fetches a pack zip over https (size-limited).
func DownloadPack(r *http.Request, rawURL string) ([]byte, error) {
	if !strings.HasPrefix(strings.ToLower(rawURL), "https://") {
		return nil, errors.New("only https:// links")
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: setupHTTPTimeout}).Do(req) // the wizard's other downloads use the same timeout
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, libraryMaxZip+1))
	if err != nil {
		return nil, err
	}
	if len(b) > libraryMaxZip {
		return nil, fmt.Errorf("pack is larger than %d MiB", libraryMaxZip>>20)
	}
	return b, nil
}
