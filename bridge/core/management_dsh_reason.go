package core

// Plain-language reasons for "the panel could not read DSH". The panel runs beside a `dsh web`
// process, and one sentence ("DSH state could not be read") hid three different situations the user
// has to tell apart:
//
//   - dsh web is up, but its conest-collab plugin never mounted the /collab routes (HTTP 404). The
//     usual cause is another DSH on the same computer already holding the channel data lock; the
//     plugin then refuses to start (dsh/collab/instance-lock.mjs, #1019/#216);
//   - dsh web is up and answers, but with an error — DSH's own problem, not a missing plugin;
//   - the recorded address no longer answers — dsh web exited or moved, so start it again.
//
// 来源：11-06 11:38 用户附图报告角色管理页只显示「DSH state could not be read」，现场实测
// /collab/api/state 404、DSH 日志有「频道插件没有启动」、collab.lock 由桌面版 DSH 持有。
// 文字只写中文：这一句直接显示在面板上，用户的话是「要说清是频道插件没启动，不是它坏了」。

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// dshCollabLockFile mirrors dsh/collab/instance-lock.mjs LOCK_FILE.
const dshCollabLockFile = "collab.lock"

// dshCollabLockPath is the lock the channel plugin takes on its data directory.
func dshCollabLockPath() string { return filepath.Join(collabDataDir(), dshCollabLockFile) }

// dshHTTPError is the running dsh web answering a non-200 status; the code is kept so callers can
// tell "the route is not mounted" (404) from "the route failed".
type dshHTTPError struct {
	Path string
	Code int
}

func (e *dshHTTPError) Error() string { return fmt.Sprintf("dsh %s: HTTP %d", e.Path, e.Code) }

// dshStateReadError turns a failed /collab/api/state read into one plain-language reason.
func dshStateReadError(ctx context.Context, target string, err error) string {
	var he *dshHTTPError
	if errors.As(err, &he) {
		if he.Code == http.StatusNotFound {
			return dshCollabNotMounted(ctx)
		}
		return fmt.Sprintf("DSH 有回应，但 %s 返回 HTTP %d %s——这是 DSH 自己的报错，不是频道插件没启动。",
			he.Path, he.Code, http.StatusText(he.Code))
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "dial" {
		return fmt.Sprintf("DSH 没在跑：状态文件记的 %s 连不上（%v）。dsh web 可能已经退出或换了端口，重新点「打开 DSH」。",
			target, err)
	}
	return fmt.Sprintf("DSH 状态读不出来：请求 %s 失败（%v）。", target, err)
}

// dshCollabNotMounted explains a 404 from the /collab routes: dsh web is up, but the channel plugin
// did not mount them. A lock held by another process names the DSH that already uses the data.
func dshCollabNotMounted(ctx context.Context) string {
	lock := dshCollabLockPath()
	head := "频道插件没有启动——dsh web 在跑，但 conest-collab 没挂上 /collab 路由（HTTP 404）"
	switch _, err := os.Stat(lock); {
	case err == nil:
		if holder := dshCollabLockHolder(ctx, lock); holder != "" {
			return fmt.Sprintf("%s。频道数据 %s 被 %s 占着：这台电脑上已经有另一个 DSH 在用同一份频道数据。"+
				"请用已经打开的那个 DSH；要换就先关掉它再打开。", head, lock, holder)
		}
		return fmt.Sprintf("%s。频道数据 %s 在，但看不出是谁占着（可能没有权限），多半是另一个 DSH 在用它。"+
			"请先关掉别的 DSH 再打开这个。", head, lock)
	}
	msg := head + "，可能没装好或启动时报了错"
	if web, _, ok := readDSHWebState(); ok {
		if logPath := dshWebLogPath(web); logPath != "" {
			msg += "，日志见 " + logPath
		}
	}
	return msg + "。"
}

// dshHostStateReadable explains an unreadable ~/.bothouse/dsh-web.json: the panel does not know where
// dsh web is, which is not the same as dsh web being broken.
const dshHostStateReadable = "读不到 DSH 的启动记录（~/.bothouse/dsh-web.json 内容不完整）：重新点「打开 DSH」会重写它。"

// dshStatusReason is the readable reason for a non-2xx answer from a dedicated DSH endpoint whose
// body carried no usable error. A 404 on the /collab routes means the plugin is not mounted.
func dshStatusReason(ctx context.Context, path string, code int) string {
	if code == http.StatusNotFound {
		return dshCollabNotMounted(ctx)
	}
	return fmt.Sprintf("DSH 有回应，但 %s 返回 HTTP %d %s。", path, code, http.StatusText(code))
}

// dshUnavailableReason explains a dshStatus that is not "running" for a request that needed DSH.
func dshUnavailableReason(status dshStatus) string {
	if status.Status == "stopped" {
		return "DSH 没在跑，所以成员管理读不到：先从面板点「打开 DSH」。"
	}
	if status.Error != "" {
		return status.Error
	}
	return "DSH 状态不明，成员管理读不到。"
}

// 来源：#216 现场 lsof 实测 0.1–0.3s；只在 404 分支且锁文件存在时调用，2s 只为慢机器留余量。
const dshCollabLockProbeTimeout = 2 * time.Second

// dshCollabLockHolder names the process holding path, or "" when it cannot be told.
func dshCollabLockHolder(ctx context.Context, path string) string {
	ctx, cancel := context.WithTimeout(ctx, dshCollabLockProbeTimeout)
	defer cancel()
	return collabLockHolder(ctx, path)
}

// parseCollabLockHolder reads the first data row of `lsof -nP <path>` (COMMAND PID USER FD …) as
// "COMMAND（pid PID）". Anything else — no rows, a header only, an error line — is "".
func parseCollabLockHolder(out string) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 2 {
		return ""
	}
	fields := strings.Fields(lines[1])
	if len(fields) < 2 {
		return ""
	}
	pid, err := strconv.Atoi(fields[1])
	if err != nil || pid <= 0 {
		return ""
	}
	return fields[0] + "（pid " + fields[1] + "）"
}
