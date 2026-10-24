//go:build !no_antigravity

package main

import "github.com/chenhg5/cc-connect/agent/antigravity"

func init() { pluginUsageLogSources = append(pluginUsageLogSources, antigravity.NewUsageLogSource()) }
