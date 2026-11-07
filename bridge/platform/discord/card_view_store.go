package discord

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: what each card was last drawn from, kept on disk, so a 细节/简略
// press re-draws a card of an earlier turn or one sent before a restart.
// Source: user 2026-11-07 「我点的是简略，然后我想切换细节，原本的简略出来的东西它
// 不会变，还是那个东西」 — the renderers lived in memory only and were dropped
// when the channel's next turn started or the process restarted; a press on
// such a card then changed the buttons and the remembered choice but left the
// text as it was.
//
// One small file per card message under <dataDir>/discord_cards/.

const cardSourceDir = "discord_cards"

const (
	cardKindProgress = "progress"
	cardKindTable    = "table"
	cardKindTask     = "task"
)

// cardSource is the input a card's two views are rendered from.
type cardSource struct {
	Kind    string     `json:"kind"`
	Content string     `json:"content,omitempty"` // progress card / sub-agent table payload
	Task    *core.Task `json:"task,omitempty"`    // task card snapshot
	Lang    string     `json:"lang,omitempty"`
	Footer  string     `json:"footer,omitempty"` // task card marker
	// Turn bookkeeping, filled when the source is saved.
	Channel string   `json:"channel,omitempty"`
	Origin  string   `json:"origin,omitempty"`
	Leader  string   `json:"leader,omitempty"` // the turn's progress card; itself for a progress card
	Mode    cardView `json:"mode,omitempty"`   // the turn's chosen view (on the progress card)
}

// render rebuilds the card's renderer from its source.
func (s cardSource) render() (cardRender, bool) {
	switch s.Kind {
	case cardKindProgress:
		r, ok := progressCardRender(s.Content)
		r.src = s
		return r, ok
	case cardKindTable:
		r, ok := subTaskTableRender(s.Content)
		r.src = s
		return r, ok
	case cardKindTask:
		if s.Task == nil {
			return cardRender{}, false
		}
		return taskCardRender(s.Task, s.Lang, s.Footer), true
	}
	return cardRender{}, false
}

type cardSourceStore struct {
	mu  sync.Mutex
	dir string // "" keeps nothing
}

var (
	cardSourceStoresMu sync.Mutex
	cardSourceStores   = map[string]*cardSourceStore{}
)

// cardSourceStoreFor returns the process-wide store of a data dir.
func cardSourceStoreFor(dataDir string) *cardSourceStore {
	dir := filepath.Join(dataDir, cardSourceDir)
	cardSourceStoresMu.Lock()
	defer cardSourceStoresMu.Unlock()
	if s, ok := cardSourceStores[dir]; ok {
		return s
	}
	s := &cardSourceStore{dir: dir}
	cardSourceStores[dir] = s
	return s
}

func cardSourceFileName(messageID string) string {
	if messageID == "" || strings.ContainsAny(messageID, `/\.`) {
		return ""
	}
	return messageID + ".json"
}

func (s *cardSourceStore) save(messageID string, src cardSource) {
	if s == nil || s.dir == "" {
		return
	}
	name := cardSourceFileName(messageID)
	if name == "" {
		return
	}
	raw, err := json.Marshal(src)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.dir, name)
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		slog.Warn("discord: card source dir", "dir", s.dir, "error", err)
		return
	}
	if err := core.AtomicWriteFile(path, raw, 0o600); err != nil {
		slog.Warn("discord: save card source", "path", path, "error", err)
		return
	}
}

// setMode records a turn's chosen view on its progress card's file.
func (s *cardSourceStore) setMode(leader string, mode cardView) {
	src, ok := s.load(leader)
	if !ok || src.Mode == mode {
		return
	}
	src.Mode = mode
	s.save(leader, src)
}

func (s *cardSourceStore) load(messageID string) (cardSource, bool) {
	if s == nil || s.dir == "" {
		return cardSource{}, false
	}
	name := cardSourceFileName(messageID)
	if name == "" {
		return cardSource{}, false
	}
	s.mu.Lock()
	raw, err := os.ReadFile(filepath.Join(s.dir, name))
	s.mu.Unlock()
	if err != nil {
		return cardSource{}, false
	}
	var src cardSource
	if json.Unmarshal(raw, &src) != nil || src.Kind == "" {
		return cardSource{}, false
	}
	return src, true
}

// turn returns the saved cards filed under a progress card, other than it.
func (s *cardSourceStore) turn(leader string) map[string]cardSource {
	out := map[string]cardSource{}
	if s == nil || s.dir == "" || leader == "" {
		return out
	}
	s.mu.Lock()
	entries, _ := os.ReadDir(s.dir)
	s.mu.Unlock()
	for _, e := range entries {
		id, ok := strings.CutSuffix(e.Name(), ".json")
		if !ok || id == leader {
			continue
		}
		if src, ok := s.load(id); ok && src.Leader == leader {
			out[id] = src
		}
	}
	return out
}

// taskCardRender renders a task card snapshot in either view.
func taskCardRender(task *core.Task, lang, footer string) cardRender {
	snapshot := task.Clone()
	return cardRender{
		lang: lang,
		src:  cardSource{Kind: cardKindTask, Task: snapshot, Lang: lang, Footer: footer},
		embeds: func(v cardView) []*discordgo.MessageEmbed {
			embed := renderTaskCardEmbedView(snapshot, lang, v)
			embed.Footer = &discordgo.MessageEmbedFooter{Text: footer}
			embed.Timestamp = snapshot.UpdatedAt.Format(time.RFC3339)
			return []*discordgo.MessageEmbed{embed}
		},
	}
}
