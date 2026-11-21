package cloudweb

import (
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

func findLocalDSHGateway() (origin, token string, err error) {
	host, ok := core.FindLocalDSHHost()
	if !ok {
		return "", "", fmt.Errorf("local DSH Channels host is unavailable")
	}
	return host.BotGateway()
}
