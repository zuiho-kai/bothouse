package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// install.sh used `npm prefix -g` as a PATH entry verbatim. On Windows npm reports the drive
// form (C:\Users\...\npm), and an unescaped "C:" splits the PATH entry at the colon, so pnpm
// installed by the script stayed invisible and the install only worked on a second run (#161).
// The script must convert that prefix before using it; this test stands in for Git Bash with a
// npm that prints the Windows form and a cygpath that maps it back to a real directory.
func TestInstallScriptConvertsWindowsNPMPrefix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install.sh runs under Git Bash on Windows")
	}
	for _, cmd := range []string{"bash", "node"} {
		if _, err := exec.LookPath(cmd); err != nil {
			t.Skipf("%s not available", cmd)
		}
	}

	root := t.TempDir()
	dshDir := filepath.Join(root, "dsh")
	script, err := ExtractEmbeddedDSH(dshDir)
	if err != nil {
		t.Fatal(err)
	}

	npmDir := filepath.Join(root, "npm-global") // stands for the C:\...\npm directory
	if err := os.MkdirAll(npmDir, 0755); err != nil {
		t.Fatal(err)
	}
	pnpmLog := filepath.Join(root, "pnpm.log")
	writeStub := func(dir, name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0755); err != nil {
			t.Fatal(err)
		}
	}

	stubs := filepath.Join(root, "stubs")
	if err := os.MkdirAll(stubs, 0755); err != nil {
		t.Fatal(err)
	}
	writeStub(stubs, "dsh", "#!/bin/sh\nexit 0\n")
	// Windows-form prefix, as real npm prints it under Git Bash.
	writeStub(stubs, "npm", "#!/bin/sh\n"+
		"if [ \"$1\" = prefix ] && [ \"$2\" = -g ]; then printf '%s\\n' 'C:\\Users\\tester\\AppData\\Roaming\\npm'; exit 0; fi\n"+
		"if [ \"$1\" = i ] && [ \"$2\" = -g ] && [ \"$3\" = pnpm ]; then\n"+
		"  printf '#!/bin/sh\\necho \"$*\" >> \"$PNPM_LOG\"\\nmkdir -p node_modules\\nexit 0\\n' > \"$STUB_NPM_DIR/pnpm\"\n"+
		"  chmod +x \"$STUB_NPM_DIR/pnpm\"\n"+
		"  exit 0\n"+
		"fi\n"+
		"exit 1\n")
	writeStub(stubs, "cygpath", "#!/bin/sh\ncase \"$1\" in -u) shift ;; esac\nprintf '%s\\n' \"$STUB_NPM_DIR\"\n")
	writeStub(stubs, "node", "#!/bin/sh\nexit 0\n")

	cmd := exec.Command("bash", script, "web")
	cmd.Env = []string{
		// /usr/bin:/bin has the shell tools install.sh uses but no pnpm, so the script has to go
		// through the npm prefix branch and find the pnpm its own `npm i -g pnpm` just wrote.
		"PATH=" + stubs + ":/usr/bin:/bin",
		"HOME=" + root,
		"DSH_HOME=" + filepath.Join(root, ".dsh"),
		"STUB_NPM_DIR=" + npmDir,
		"PNPM_LOG=" + pnpmLog,
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("install.sh failed with a converted npm prefix: %v\n%s", err, out)
	}
	if b, _ := os.ReadFile(pnpmLog); len(b) == 0 {
		t.Fatalf("pnpm installed by the script was never used; output:\n%s", out)
	}
	if _, err := os.Stat(filepath.Join(dshDir, "collab", "node_modules", collabDepsStamp)); err != nil {
		t.Errorf("deps stamp not written, pnpm install did not run: %v", err)
	}
}
