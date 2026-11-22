//go:build !no_devin

package main

import "github.com/chenhg5/cc-connect/agent/devin"

func init() { pluginUsageLogSources = append(pluginUsageLogSources, devin.NewUsageLogSource()) }
