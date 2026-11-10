//go:build windows

package antigravityhook

const lockSupported = false

func lockDir(string) (func(), error) { return nil, errLockUnsupported }
