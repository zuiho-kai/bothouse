//go:build windows

package core

import (
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

// savedPathDirs returns the PATH Windows hands to new processes: the user's (HKCU\Environment) and
// the machine's (HKLM\…\Session Manager\Environment). An installer run while bothouse is open
// writes its directory there; this process keeps the PATH it was started with, so a CLI installed
// after startup is only found through these (#1881).
func savedPathDirs() []string {
	var dirs []string
	for _, k := range []struct {
		root registry.Key
		path string
	}{
		{registry.CURRENT_USER, `Environment`},
		{registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`},
	} {
		key, err := registry.OpenKey(k.root, k.path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		v, _, err := key.GetStringValue("Path")
		_ = key.Close()
		if err != nil {
			continue
		}
		// Path is usually REG_EXPAND_SZ (%USERPROFILE%\…, %NVM_HOME%).
		if expanded, err := registry.ExpandString(v); err == nil {
			v = expanded
		}
		dirs = append(dirs, filepath.SplitList(v)...)
	}
	return dirs
}
