package qq

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// watermarkPathSegment keeps a project name usable as one directory name.
// 沿用 platform/weixin 的同名实现语义（不跨包引用，避免为一条路径改动别的平台）。
func watermarkPathSegment(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "default"
	}
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '/', '\\', ':', '\x00':
			b.WriteByte('_')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// chatState is what the watermark remembers for one chat.
//
// Floor is the newest message time already handled. IDs lists the message ids
// handled *at* Floor. The split exists because OneBot reports times in whole
// seconds: two different messages can share a second, so a time alone cannot
// say that a specific message was handled. Anything strictly older than Floor
// is covered by the floor; a message exactly at Floor must be recognised by its
// own id (second-segment review, P2 #1).
type chatState struct {
	Floor int64    `json:"floor"`
	IDs   []string `json:"ids,omitempty"`
}

// recvWatermark remembers, per chat, which messages this bridge has already
// handled, and keeps it on disk so a restart does not treat that history as
// missed backlog.
//
// Why it has to be a file: every in-memory guard (core.MessageDedup,
// catchUpSeen) starts empty in a new process, so after a restart the same
// replayed messages look new again. The catch-up boundary cannot cover it
// either — a fresh process has not seen a single disconnect yet, so it has
// nothing measured to compare against and can only guess from the reconnect
// budget. The watermark is the only durable answer to "what did we already
// deal with".
//
// The key is the raw chat (group id / user id), not the session key: a change
// to share_session_in_channel renames sessions but not chats, and the watermark
// must not be invalidated by that.
type recvWatermark struct {
	mu   sync.Mutex
	path string
	last map[string]chatState

	// saving guards against piling up concurrent file writers; the in-memory
	// map is always the source of truth.
	saving bool
	dirty  bool
}

// newRecvWatermark loads the watermark from path. An empty path keeps the
// watermark purely in memory (tests, and configs without a data dir).
func newRecvWatermark(path string) *recvWatermark {
	w := &recvWatermark{path: path, last: map[string]chatState{}}
	if path == "" {
		return w
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		// A missing file is the normal first run; a broken one must not stop
		// the bridge, so it starts from empty and the next save rewrites it.
		return w
	}
	var loaded map[string]chatState
	if json.Unmarshal(raw, &loaded) == nil && loaded != nil {
		w.last = loaded
		return w
	}
	// Older files stored a bare time per chat. Read them as a floor with no
	// known ids: that is exactly what they meant, and a message at that floor
	// then gets the id check it needs instead of being assumed handled.
	var legacy map[string]int64
	if json.Unmarshal(raw, &legacy) == nil {
		for k, v := range legacy {
			w.last[k] = chatState{Floor: v}
		}
	}
	return w
}

// seen reports whether this exact message was already handled. A message older
// than the chat's floor is covered; one exactly at the floor is only covered
// when its own id was recorded — never because another message of that same
// second was.
func (w *recvWatermark) seen(chat, id string, msgTime time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	st, ok := w.last[chat]
	if !ok {
		return false
	}
	ts := msgTime.Unix()
	if ts < st.Floor {
		return true
	}
	if ts > st.Floor {
		return false
	}
	return containsString(st.IDs, id)
}

// observe records that this message was handled and schedules a save.
func (w *recvWatermark) observe(chat, id string, msgTime time.Time) {
	if w == nil {
		return
	}
	w.mu.Lock()
	ts := msgTime.Unix()
	st := w.last[chat]
	switch {
	case ts > st.Floor:
		// A newer second: everything at the old floor is now strictly older
		// than the new one, so its ids no longer carry information.
		st = chatState{Floor: ts, IDs: []string{id}}
	case ts == st.Floor:
		if !containsString(st.IDs, id) {
			st.IDs = append(st.IDs, id)
		}
	default:
		w.mu.Unlock()
		return
	}
	w.last[chat] = st
	needSave := w.path != ""
	alreadySaving := w.saving
	if needSave {
		w.dirty = true
		if !alreadySaving {
			w.saving = true
		}
	}
	w.mu.Unlock()

	if needSave && !alreadySaving {
		go w.saveLoop()
	}
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

// saveLoop writes the map to disk until no newer observation arrived while
// writing, so a burst of messages costs one file write instead of one each.
//
// The write is asynchronous, so a process killed immediately after a message
// can lose the newest floor. That window is deliberate: writing synchronously
// would put disk latency on every message. It also fails in the safe
// direction — a stale floor makes the bridge treat one message as unseen, so
// the worst case is handling a message twice, never dropping one.
func (w *recvWatermark) saveLoop() {
	for {
		w.mu.Lock()
		if !w.dirty {
			w.saving = false
			w.mu.Unlock()
			return
		}
		w.dirty = false
		snapshot := make(map[string]chatState, len(w.last))
		for k, v := range w.last {
			snapshot[k] = chatState{Floor: v.Floor, IDs: append([]string(nil), v.IDs...)}
		}
		path := w.path
		w.mu.Unlock()

		writeWatermarkFile(path, snapshot)
	}
}

// writeWatermarkFile replaces the file atomically: a half-written file would
// lose the whole watermark on the next start, so write a sibling and rename.
func writeWatermarkFile(path string, values map[string]chatState) {
	raw, err := json.Marshal(values)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

// chats snapshots the watermark as a pull list.
func (w *recvWatermark) chats() []catchUpChat {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]catchUpChat, 0, len(w.last))
	for k, st := range w.last {
		out = append(out, catchUpChat{key: k, sinceTS: st.Floor})
	}
	// Deterministic order: tests and logs stay comparable between runs.
	sort.Slice(out, func(i, j int) bool { return out[i].key < out[j].key })
	return out
}
