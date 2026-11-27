package discord

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core/model"

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
	Kind    string      `json:"kind"`
	Content string      `json:"content,omitempty"` // progress card / sub-agent table payload
	Task    *model.Task `json:"task,omitempty"`    // task card snapshot
	Lang    string      `json:"lang,omitempty"`
	Footer  string      `json:"footer,omitempty"` // task card marker
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
	mu    sync.Mutex
	dir   string    // "" keeps nothing
	swept time.Time // last sweep
}

// cardSourceKeep is how long a card's source stays on disk. A press on an older card only
// changes the buttons and the channel's remembered choice, as for a card with no source.
// The directory used to keep every card for good (about 20 MB a day on a busy server).
const cardSourceKeep = 7 * 24 * time.Hour

// cardIndexedMark: the directory's cards saved before the per-turn members files existed
// have been filed (sweep does it once).
const cardIndexedMark = ".indexed"

// membersPath is the list of the cards filed under a progress card, one message id a line.
func (s *cardSourceStore) membersPath(leader string) string {
	return filepath.Join(s.dir, leader+".members")
}

// fileMember notes a card under its turn's progress card, so turn reads that turn's files
// instead of every file in the directory. Caller holds mu.
func (s *cardSourceStore) fileMember(leader, member string) {
	if leader == "" || leader == member || cardSourceFileName(leader) == "" {
		return
	}
	path := s.membersPath(leader)
	raw, _ := os.ReadFile(path)
	for _, id := range strings.Fields(string(raw)) {
		if id == member {
			return
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		slog.Warn("discord: file card under its turn", "path", path, "error", err)
		return
	}
	_, _ = f.WriteString(member + "\n")
	_ = f.Close()
}

// sweepIfDue, once an hour, removes sources older than cardSourceKeep. Its first run in a
// directory also files the cards saved before the members files existed.
func (s *cardSourceStore) sweepIfDue() {
	s.mu.Lock()
	due := time.Since(s.swept) > time.Hour
	if due {
		s.swept = time.Now()
	}
	s.mu.Unlock()
	if !due {
		return
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	mark := filepath.Join(s.dir, cardIndexedMark)
	_, statErr := os.Stat(mark)
	indexed := statErr == nil
	old := time.Now().Add(-cardSourceKeep)
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(old) {
			_ = os.Remove(filepath.Join(s.dir, name))
			continue
		}
		if id, ok := strings.CutSuffix(name, ".json"); ok && !indexed {
			if src, ok := s.load(id); ok {
				s.mu.Lock()
				s.fileMember(src.Leader, id)
				s.mu.Unlock()
			}
		}
	}
	if !indexed {
		_ = os.WriteFile(mark, nil, 0o600)
	}
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
	path := filepath.Join(s.dir, name)
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		s.mu.Unlock()
		slog.Warn("discord: card source dir", "dir", s.dir, "error", err)
		return
	}
	if err := core.AtomicWriteFile(path, raw, 0o600); err != nil {
		s.mu.Unlock()
		slog.Warn("discord: save card source", "path", path, "error", err)
		return
	}
	s.fileMember(src.Leader, messageID)
	s.mu.Unlock()
	s.sweepIfDue()
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
	if cardSourceFileName(leader) == "" {
		return out
	}
	s.mu.Lock()
	raw, _ := os.ReadFile(s.membersPath(leader))
	s.mu.Unlock()
	for _, id := range strings.Fields(string(raw)) {
		if id == leader {
			continue
		}
		if src, ok := s.load(id); ok && src.Leader == leader {
			out[id] = src
		}
	}
	return out
}

// taskCardRender renders a task card snapshot in either view.
func taskCardRender(task *model.Task, lang, footer string) cardRender {
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
