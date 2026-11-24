package cloudweb

import (
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

func newLocalDSH(opts map[string]any) (core.Platform, error) {
	if _, ok := opts[core.LocalDSHRoomOption]; !ok {
		return nil, fmt.Errorf("local DSH: a room is required")
	}
	return newPlatform(core.LocalDSHPlatformType, opts)
}

func findLocalDSHGateway() (origin, token string, err error) {
	host, ok := core.FindLocalDSHHost()
	if !ok {
		return "", "", fmt.Errorf("local DSH Channels host is unavailable")
	}
	return host.BotGateway()
}
