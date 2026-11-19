//go:build !windows && !darwin

package core

// osLocaleName: Linux carries the locale in LC_ALL / LANG, which SystemLanguage reads first.
func osLocaleName() string { return "" }
