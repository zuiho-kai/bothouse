package core

// 插件卸载 (#1377) 的进程树收尾：Windows Job 的归零轮询要有失败出口。
//
// TerminateJobObject 只是发起终止；被内核态等待、杀毒或文件过滤驱动挂住的进程可以长期不退出。
// 这段轮询发生在写锁内、在 handler 的 30 秒 ctx 之外（defer 在 ctx 生命周期之后），所以它自己
// 必须有上限：没有上限时，HTTP 请求和 profile 写锁会一起无限期挂住，既不出 409 也不保留锁的
// 明确答复，后续写者只能等 120 秒拿 busy。

import (
	"fmt"
	"time"
)

// waitPluginUninstallIdle polls active until it reports no live process, or until timeout.
// active is the Job's ActiveProcesses count: nested-job descendants are included, so zero means
// the helper, pnpm and everything pnpm started have exited.
func waitPluginUninstallIdle(active func() (uint32, error), timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		n, err := active()
		if err != nil {
			return fmt.Errorf("wait for uninstall job: %w", err)
		}
		if n == 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("等不到卸载子进程归零：%s 后 Job 里还有 %d 个进程没退出", timeout, n)
		}
		// 沿用 profile 锁的现有轮询间隔。
		time.Sleep(pluginLockRetryInitial)
	}
}

// pluginUninstallCleanupError marks a cleanup we could not confirm. The caller keeps the profile
// write lock when this error is returned: another writer must not enter a tree that may still be
// writing the profile.
func pluginUninstallCleanupError(err error) error {
	return fmt.Errorf("%w: 无法确认卸载子进程已退出：%v", errPluginLockRetain, err)
}
