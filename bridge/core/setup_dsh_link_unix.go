//go:build !windows

package core

import "os"

// linkDir makes link point at the directory target (pnpm's own kind of link on this OS).
func linkDir(target, link string) error { return os.Symlink(target, link) }
