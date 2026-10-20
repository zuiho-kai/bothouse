//go:build windows

package config

import (
	"fmt"
	"syscall"
	"time"
)

// lockConfigFile: on Windows an exclusive open (share mode 0) of <config>.wizard.lock
// acts as the cross-process lock; retried while another process holds it.
func lockConfigFile(path string) (func(), error) {
	p, err := syscall.UTF16PtrFromString(configLockPath(path))
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(30 * time.Second) // 来源：沿用 cc-connect 其它配置写入不会超过秒级；30 秒只防死等
	for {
		h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
		if err == nil {
			return func() { syscall.CloseHandle(h) }, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("config is locked by another process: %w", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
