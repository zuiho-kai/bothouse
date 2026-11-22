//go:build !no_discord

package main

import (
	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/platform/discord"
)

func init() { discord.VoiceListenerFS = ccconnect.VoiceFiles }
