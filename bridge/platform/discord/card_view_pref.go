package discord

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: the last 「细节」/「简略」 choice per channel, kept on disk so a
// new turn, a restart or a new binary starts in it. Source: user 2026-10-23
// 「默认简略，但是用户可以自定义，并且记住，更新版本也要记得，要记得之前选择」.
// Keyed by the turn's origin channel, shared by every bot of the process (橘
// chose per channel; an added setting, listed in the delivery). Without a
// recorded choice, or with an unreadable file, the view is cardViewDefault.

const cardViewPrefFile = "discord_card_view.json"

type cardViewPrefs struct {
	mu    sync.Mutex
	path  string              // "" keeps the choices in memory only
	modes map[string]cardView // channel ID -> chosen view
	// start: a channel's view before anyone chose one (task threads start detailed); in memory.
	start map[string]cardView
}

var (
	cardViewPrefsMu    sync.Mutex
	cardViewPrefsByDir = map[string]*cardViewPrefs{}
)

// cardViewPrefsFor returns the process-wide store of a data dir, so all bots
// sharing the dir see one choice per channel.
func cardViewPrefsFor(dataDir string) *cardViewPrefs {
	path := filepath.Join(dataDir, cardViewPrefFile)
	cardViewPrefsMu.Lock()
	defer cardViewPrefsMu.Unlock()
	if s, ok := cardViewPrefsByDir[path]; ok {
		return s
	}
	s := loadCardViewPrefs(path)
	cardViewPrefsByDir[path] = s
	return s
}

func loadCardViewPrefs(path string) *cardViewPrefs {
	s := &cardViewPrefs{path: path, modes: map[string]cardView{}}
	raw, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		slog.Warn("discord: card view prefs unreadable, using default", "path", path, "error", err)
		return s
	}
	for ch, v := range m {
		if mode := cardView(v); mode == cardViewDetail || mode == cardViewBrief {
			s.modes[ch] = mode
		}
	}
	return s
}

func (s *cardViewPrefs) get(channelID string) cardView {
	if s == nil || channelID == "" {
		return cardViewDefault
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if m, ok := s.modes[channelID]; ok {
		return m
	}
	if m, ok := s.start[channelID]; ok {
		return m
	}
	return cardViewDefault
}

func (s *cardViewPrefs) set(channelID string, mode cardView) {
	if s == nil || channelID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.modes == nil {
		s.modes = map[string]cardView{}
	}
	if s.modes[channelID] == mode {
		return
	}
	s.modes[channelID] = mode
	if s.path == "" {
		return
	}
	raw, _ := json.Marshal(s.modes)
	if err := core.AtomicWriteFile(s.path, raw, 0o600); err != nil {
		slog.Warn("discord: save card view prefs", "path", s.path, "error", err)
	}
}
