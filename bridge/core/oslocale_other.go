//go:build !windows

package core

// osLocaleName: macOS and Linux carry the locale in LC_ALL / LANG, which SystemLanguage reads first.
func osLocaleName() string { return "" }
