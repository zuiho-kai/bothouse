package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

// boolPaths lists the toml path of every bool / *bool under t, following structs and pointers to
// structs. Slices and maps are not followed: their entries are data, not one switch.
func boolPaths(t reflect.Type, prefix string, out *[]string) {
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		tag := strings.Split(f.Tag.Get("toml"), ",")[0]
		if tag == "" || tag == "-" {
			continue
		}
		ft := f.Type
		if ft.Kind() == reflect.Pointer {
			ft = ft.Elem()
		}
		switch ft.Kind() {
		case reflect.Bool:
			*out = append(*out, prefix+tag)
		case reflect.Struct:
			boolPaths(ft, prefix+tag+".", out)
		}
	}
}

// Every boolean of config.toml is either a registered feature switch or named in featureNotSwitch
// with the reason it is left out, so a new switch cannot stay outside the one list (#1861).
func TestFeatureSwitchesCoverEveryBoolean(t *testing.T) {
	registered := map[string]bool{}
	for _, f := range FeatureSwitches() {
		key := f.Key
		if f.Scope == FeatureScopeProject {
			key = "projects." + key
		}
		if registered[key] {
			t.Errorf("%s is registered twice", key)
		}
		registered[key] = true
		if f.Name == "" || f.Desc == "" || f.NameEN == "" || f.DescEN == "" {
			t.Errorf("%s: name and description are required in both languages", key)
		}
	}
	var paths []string
	boolPaths(reflect.TypeOf(Config{}), "", &paths)
	boolPaths(reflect.TypeOf(ProjectConfig{}), "projects.", &paths)
	seen := map[string]bool{}
	for _, path := range paths {
		seen[path] = true
		_, skipped := featureNotSwitch[path]
		if registered[path] == skipped {
			t.Errorf("%s: registered=%v, in featureNotSwitch=%v — add it to exactly one of the two lists in features.go",
				path, registered[path], skipped)
		}
	}
	for key := range registered {
		if !seen[key] {
			t.Errorf("registered switch %s is not a boolean of config.toml", key)
		}
	}
	for key := range featureNotSwitch {
		if !seen[key] {
			t.Errorf("featureNotSwitch names %s, which is not a boolean of config.toml", key)
		}
	}
}

// lookup walks a decoded toml table along a dotted path.
func lookup(m map[string]any, path string) (any, bool) {
	var cur any = m
	for _, part := range strings.Split(path, ".") {
		tbl, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		if cur, ok = tbl[part]; !ok {
			return nil, false
		}
	}
	return cur, true
}

// Flipping a switch changes exactly its key in config.toml, the list reads it back, and a switch
// that needs a restart is reported as pending against the start-time snapshot.
func TestSetFeatureSwitchWritesItsKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	base := "language = \"zh\"\n\n[[projects]]\nname = \"r1\"\n\n[projects.agent]\ntype = \"claudecode\"\n"
	old := ConfigPath
	ConfigPath = path
	t.Cleanup(func() { ConfigPath = old })

	for _, f := range FeatureSwitches() {
		if err := os.WriteFile(path, []byte(base), 0o600); err != nil {
			t.Fatal(err)
		}
		project := ""
		if f.Scope == FeatureScopeProject {
			project = "r1"
		}
		before, lang, err := ListFeatureStates(nil)
		if err != nil || lang != "zh" {
			t.Fatalf("list: %v (lang %q)", err, lang)
		}
		boot := map[string]bool{}
		var was FeatureState
		for _, s := range before {
			boot[s.ID()] = s.On
			if s.Key == f.Key && s.Project == project {
				was = s
			}
		}
		if was.On != was.Default || was.PendingRestart {
			t.Errorf("%s: an empty config gives on=%v default=%v pending=%v", f.Key, was.On, was.Default, was.PendingRestart)
		}
		restart, err := SetFeatureSwitch(project, f.Key, !was.On)
		if err != nil {
			t.Fatalf("%s: set: %v", f.Key, err)
		}
		if restart != f.Restart {
			t.Errorf("%s: set reports restart=%v, registry says %v", f.Key, restart, f.Restart)
		}
		var raw map[string]any
		if _, err := toml.DecodeFile(path, &raw); err != nil {
			t.Fatal(err)
		}
		tbl := raw
		if project != "" {
			tbl = raw["projects"].([]map[string]any)[0]
		}
		want := !was.On != f.Inverted
		if got, ok := lookup(tbl, f.Key); !ok || got != want {
			t.Errorf("%s: config.toml has %v (present %v), want %v", f.Key, got, ok, want)
		}
		after, _, err := ListFeatureStates(boot)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range after {
			same := s.Key == f.Key && s.Project == project
			switch {
			case same && (s.On == was.On || s.PendingRestart != f.Restart || s.Running != (f.Restart == was.On)):
				t.Errorf("%s: after set on=%v running=%v pending=%v (was on=%v, restart=%v)", f.Key, s.On, s.Running, s.PendingRestart, was.On, f.Restart)
			case !same && s.Project != "" && "display."+s.Key == f.Key:
				// a role without its own setting follows the global display switch
			case !same && s.On != boot[s.ID()]:
				t.Errorf("flipping %s also changed %s", f.Key, s.ID())
			}
		}
	}
	if _, err := SetFeatureSwitch("", "management.enabled", false); err == nil {
		t.Error("a key outside the registry was accepted")
	}
	if _, err := SetFeatureSwitch("nobody", "team_board", false); err == nil {
		t.Error("an unknown project was accepted")
	}
}
