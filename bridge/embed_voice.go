package ccconnect

import "embed"

// VoiceFiles: the Discord voice listener of the meeting assistant (platform/discord/meeting.go).
// The bridge releases it into its data dir and installs its npm dependencies there
// (platform/discord/meeting_listener.go).
//
//go:embed contrib/discord-voice/listener.mjs contrib/discord-voice/asr_worker.py contrib/discord-voice/package.json
var VoiceFiles embed.FS
