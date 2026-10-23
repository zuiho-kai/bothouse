//go:build !windows

package core

import "testing"

// unix: exec(2) the old binary in place, argv[0] = exe, same arguments.
func TestExecOld(t *testing.T) {
	var gotPath string
	var gotArgv []string
	err := execOld(func(p string, argv, env []string) error { gotPath, gotArgv = p, argv; return nil }, "/x/bothouse", []string{"--config", "c"})
	if err != nil || gotPath != "/x/bothouse" || len(gotArgv) != 3 || gotArgv[0] != "/x/bothouse" || gotArgv[2] != "c" {
		t.Fatalf("path=%q argv=%v err=%v", gotPath, gotArgv, err)
	}
}
