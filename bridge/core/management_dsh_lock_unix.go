//go:build !windows

package core

import (
	"context"
	"os/exec"
)

// collabLockHolder names the process holding path, as "<command> pid <pid>", or "" when it cannot
// be told (no lsof, no permission, or nobody holds it). See parseCollabLockHolder for the parsing.
//
// 来源：11-06 现场 `lsof ~/.conest-collab/collab.lock` 打出 `DeepSeek 11185 …`；lsof 的列是
// COMMAND PID USER FD TYPE …, so the first two fields are what a user needs to recognise the app.
func collabLockHolder(ctx context.Context, path string) string {
	out, err := exec.CommandContext(ctx, "lsof", "-nP", path).Output()
	if err != nil {
		return ""
	}
	return parseCollabLockHolder(string(out))
}
