package core

import (
	"context"
	"fmt"
)

// removedPlatformTypes were dropped from bothouse (#2049). A config.toml that still lists one
// keeps starting: the platform is created as a stub whose Start fails, so the rest of the
// project runs and the management page shows the type as offline with the reason in the log.
var removedPlatformTypes = []string{
	"line", "matrix", "webex", "googlechat", "weibo", "yuanbao", "max", "tuitui",
	"wps-agentspace", "wps-xiezuo", "dingtalk",
}

func init() {
	for _, name := range removedPlatformTypes {
		n := name
		RegisterPlatform(n, func(map[string]any) (Platform, error) { return removedPlatform{name: n}, nil })
	}
}

type removedPlatform struct{ name string }

func (p removedPlatform) err() error {
	return fmt.Errorf("平台 %q 已从 bothouse 移除，请从 config.toml 删掉这段 [[projects.platforms]] / platform %q was removed from bothouse; delete it from config.toml", p.name, p.name)
}

func (p removedPlatform) Name() string                             { return p.name }
func (p removedPlatform) Start(MessageHandler) error               { return p.err() }
func (p removedPlatform) Reply(context.Context, any, string) error { return p.err() }
func (p removedPlatform) Send(context.Context, any, string) error  { return p.err() }
func (p removedPlatform) Stop() error                              { return nil }
