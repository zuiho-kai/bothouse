package discord

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

// Share ownership evidence across roles using the same data dir, as with cardSourceStore.
// Category names choose a destination only; they never establish channel ownership.
type workspaceShelfGuild struct {
	Category string          `json:"category"`
	Channels map[string]bool `json:"channels"`
}

type workspaceShelfStore struct {
	mu      sync.Mutex
	path    string
	guilds  map[string]workspaceShelfGuild
	loadErr error
}

var workspaceShelfStores = struct {
	sync.Mutex
	byPath map[string]*workspaceShelfStore
}{byPath: map[string]*workspaceShelfStore{}}

func workspaceShelfStoreFor(dir string) *workspaceShelfStore {
	path := filepath.Join(dir, "discord_workspace_shelves.json")
	workspaceShelfStores.Lock()
	defer workspaceShelfStores.Unlock()
	if s := workspaceShelfStores.byPath[path]; s != nil {
		return s
	}
	s := &workspaceShelfStore{path: path}
	raw, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(raw, &s.guilds)
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		s.loadErr = fmt.Errorf("discord: load workspace shelf ownership: %w", err)
	}
	workspaceShelfStores.byPath[path] = s
	return s
}

func (p *Platform) workspaceShelfStore() *workspaceShelfStore {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.workspaceShelves == nil {
		p.workspaceShelves = &workspaceShelfStore{}
	}
	return p.workspaceShelves
}

func (s *workspaceShelfStore) guild(id string) (workspaceShelfGuild, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.guilds[id]
	g.Channels = maps.Clone(g.Channels)
	return g, s.loadErr
}

// Record before PATCH: if saving fails, leave the channel where it is. A failed PATCH
// is harmless: the listing also checks its actual category before marking it Shelved.
func (s *workspaceShelfStore) remember(guild, category, channel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadErr != nil {
		return s.loadErr
	}
	g := s.guilds[guild]
	if g.Category == category && g.Channels[channel] {
		return nil
	}
	next := maps.Clone(s.guilds)
	if next == nil {
		next = map[string]workspaceShelfGuild{}
	}
	g.Category, g.Channels = category, maps.Clone(g.Channels)
	if g.Channels == nil {
		g.Channels = map[string]bool{}
	}
	g.Channels[channel] = true
	next[guild] = g
	if s.path != "" {
		raw, err := json.Marshal(next)
		if err != nil {
			return fmt.Errorf("discord: encode workspace shelf ownership: %w", err)
		}
		if err := core.AtomicWriteFile(s.path, raw, 0o600); err != nil {
			return fmt.Errorf("discord: save workspace shelf ownership: %w", err)
		}
	}
	s.guilds = next
	return nil
}
