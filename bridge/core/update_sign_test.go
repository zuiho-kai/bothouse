package core

import (
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const selfBuiltMsg = "本机自编译版不支持自我升级"

// asReleaseBuild makes this test binary look like a macOS release build whose signature check
// returns verifyErr (nil: the running binary carries the release signature).
func asReleaseBuild(t *testing.T, verifyErr error) {
	t.Helper()
	oldID, oldHash, oldOS, oldFn := ReleaseSignerID, ReleaseSignerHash, updateSignGOOS, verifyReleaseSignatureFn
	t.Cleanup(func() {
		ReleaseSignerID, ReleaseSignerHash, updateSignGOOS, verifyReleaseSignatureFn = oldID, oldHash, oldOS, oldFn
	})
	ReleaseSignerID, ReleaseSignerHash, updateSignGOOS = "ai.bothouse.desktop", "90C081464BA60F81CE7FF6E18767F40D5E650CD1", "darwin"
	verifyReleaseSignatureFn = func(string, string, string) error { return verifyErr }
}

// asSelfBuild: no release identity compiled in.
func asSelfBuild(t *testing.T) {
	t.Helper()
	asReleaseBuild(t, nil)
	ReleaseSignerID, ReleaseSignerHash = "", ""
}

func TestUpdateRefusal(t *testing.T) {
	cases := []struct {
		name   string
		id     string
		goos   string
		verify error
		refuse bool
	}{
		{"self-built (no identity)", "", "darwin", nil, true},
		{"self-built on linux", "", "linux", nil, true},
		{"release on linux/windows", "ai.bothouse.desktop", "linux", errors.New("not checked"), false},
		{"macOS release, release signature", "ai.bothouse.desktop", "darwin", nil, false},
		{"macOS release re-signed / ad-hoc", "ai.bothouse.desktop", "darwin", errors.New("failed requirement"), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			asReleaseBuild(t, c.verify)
			ReleaseSignerID, updateSignGOOS = c.id, c.goos
			err := UpdateRefusal()
			if (err != nil) != c.refuse {
				t.Fatalf("refusal %v, want refuse=%v", err, c.refuse)
			}
			if err != nil && (!errors.Is(err, ErrSelfBuiltUpdate) || !strings.Contains(err.Error(), selfBuiltMsg)) {
				t.Fatalf("message %q", err)
			}
		})
	}
}

func TestVerifyReleaseSignature_NoHashRefuses(t *testing.T) {
	if err := verifyReleaseSignature("/bin/ls", "ai.bothouse.desktop", ""); err == nil {
		t.Fatal("empty hash accepted")
	}
}

const testID, testHash = "ai.bothouse.desktop", "90C081464BA60F81CE7FF6E18767F40D5E650CD1"

// signedCopy copies /usr/bin/true to dir/name and ad-hoc signs it with the release identifier
// plus any extra codesign arguments. Real codesign, macOS only.
func signedCopy(t *testing.T, dir, name string, extra ...string) string {
	t.Helper()
	if runtime.GOOS != "darwin" {
		t.Skip("codesign is macOS only")
	}
	data, err := os.ReadFile("/usr/bin/true")
	if err != nil {
		t.Skip(err)
	}
	exe := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, data, 0o755); err != nil {
		t.Fatal(err)
	}
	args := append([]string{"--force", "--sign", "-", "--identifier", testID}, extra...)
	if out, err := exec.Command("/usr/bin/codesign", append(args, exe)...).CombinedOutput(); err != nil {
		t.Fatalf("codesign: %v: %s", err, out)
	}
	return exe
}

// minimalApp puts an ad-hoc signed binary into a minimal, unsealed .app like package-dmg.sh does.
func minimalApp(t *testing.T) string {
	t.Helper()
	app := filepath.Join(t.TempDir(), "Bothouse.app")
	exe := signedCopy(t, app, "Contents/MacOS/bothouse")
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>bothouse</string>
<key>CFBundleIdentifier</key><string>ai.bothouse.desktop</string></dict></plist>
`
	if err := os.WriteFile(filepath.Join(app, "Contents/Info.plist"), []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}
	return exe
}

// identifierOnly: ad-hoc signatures carry no certificate, so pass cases check only the identifier.
func identifierOnly(t *testing.T) {
	old := releaseRequirement
	t.Cleanup(func() { releaseRequirement = old })
	releaseRequirement = func(id, _ string) string { return `identifier "` + id + `"` }
}

func TestVerifyReleaseSignature_Pass(t *testing.T) {
	identifierOnly(t)
	for name, exe := range map[string]func() string{
		"single file": func() string { return signedCopy(t, t.TempDir(), "bothouse") },
		"inside .app": func() string { return minimalApp(t) },
	} {
		t.Run(name, func(t *testing.T) {
			if err := verifyReleaseSignature(exe(), testID, testHash); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestVerifyReleaseSignature_Refuses(t *testing.T) {
	forged := `-r=designated => identifier "` + testID + `" and certificate leaf = H"` + testHash + `"`
	cases := map[string]func(t *testing.T) string{
		"unsigned": func(t *testing.T) string {
			exe := signedCopy(t, t.TempDir(), "bothouse")
			if out, err := exec.Command("/usr/bin/codesign", "--remove-signature", exe).CombinedOutput(); err != nil {
				t.Fatalf("%v: %s", err, out)
			}
			return exe
		},
		"ad-hoc":                 func(t *testing.T) string { return signedCopy(t, t.TempDir(), "bothouse") },
		"ad-hoc + forged DR":     func(t *testing.T) string { return signedCopy(t, t.TempDir(), "bothouse", forged) },
		"inside .app, forged DR": func(t *testing.T) string { return signedCopy(t, t.TempDir(), "X.app/Contents/MacOS/bothouse", forged) },
		"modified byte": func(t *testing.T) string {
			identifierOnly(t) // would pass unmodified; the changed byte must fail it
			exe := signedCopy(t, t.TempDir(), "bothouse")
			data, _ := os.ReadFile(exe)
			data[len(data)/2] ^= 0xff
			if err := os.WriteFile(exe, data, 0o755); err != nil {
				t.Fatal(err)
			}
			return exe
		},
	}
	for name, mk := range cases {
		t.Run(name, func(t *testing.T) {
			exe := mk(t)
			if err := verifyReleaseSignature(exe, testID, testHash); err == nil {
				t.Fatal("accepted")
			} else {
				t.Log(err)
			}
		})
	}
}

func TestSelfUpdate_RefusesSelfBuiltBeforeDownload(t *testing.T) {
	asSelfBuild(t)
	if err := SelfUpdate("v99.0.0", false); !errors.Is(err, ErrSelfBuiltUpdate) {
		t.Fatalf("got %v", err)
	}
}

// Each entry refuses a self-built binary and a re-signed release without calling selfUpdateFn.
func refusals() map[string]func(*testing.T) {
	return map[string]func(*testing.T){
		"self-built": asSelfBuild,
		"re-signed":  func(t *testing.T) { asReleaseBuild(t, errors.New("failed requirement")) },
	}
}

func TestUpdateEntry_WebRefusesSelfBuilt(t *testing.T) {
	for name, set := range refusals() {
		t.Run(name, func(t *testing.T) {
			_, got := armFixture(t, nil)
			applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
			set(t)
			_, d := callMgmt(t, (&ManagementServer{port: 9820}).handleUpdateApply, http.MethodPost)
			if d["status"] != "failed" || !strings.Contains(d["error"].(string), selfBuiltMsg) {
				t.Fatalf("got %v", d)
			}
			if len(*applied) != 0 || len(*got) != 0 || len(RestartCh) != 0 {
				t.Fatalf("applied %v guards %d", *applied, len(*got))
			}
		})
	}
}

func TestUpdateEntry_SocketRefusesSelfBuilt(t *testing.T) {
	for name, set := range refusals() {
		t.Run(name, func(t *testing.T) {
			spec, got := armFixture(t, nil)
			applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
			withPeerExe(t, spec.Exe, true)
			set(t)
			rec := socketUpdate(socketUpdateRequest(spec.Exe, "v0.1.5"))
			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), selfBuiltMsg) {
				t.Fatalf("code %d body %s", rec.Code, rec.Body.String())
			}
			if len(*applied) != 0 || len(*got) != 0 || len(RestartCh) != 0 {
				t.Fatalf("applied %v guards %d", *applied, len(*got))
			}
		})
	}
}

func TestUpdateEntry_ChatUpgradeRefusesSelfBuilt(t *testing.T) {
	for name, set := range refusals() {
		t.Run(name, func(t *testing.T) {
			_, got := armFixture(t, nil)
			applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
			set(t)
			p := &stubPlatformEngine{n: "discord"}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			e.cmdUpgradeConfirm(p, &Message{SessionKey: "discord:c1:u1", ReplyCtx: "rc"})
			if sent := strings.Join(p.getSent(), "\n"); !strings.Contains(sent, selfBuiltMsg) {
				t.Fatalf("chat got %q", sent)
			}
			if len(*applied) != 0 || len(*got) != 0 || len(RestartCh) != 0 {
				t.Fatalf("applied %v guards %d", *applied, len(*got))
			}
		})
	}
}
