package core

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
)

// #2024: a wake that names the waking conversation (origin) gets its result back there.
// POST /wake registers the wake, the woken turn carries its ID (Message.wakeID →
// interactiveState.currentWakeID), and when that turn ends settleWakeReturn runs one turn
// in the origin session with the outcome, so the result reaches the waking conversation
// even after its own turn has ended. Records are process-local (like /input).

var errWakeNoResult = errors.New("the woken turn ended without a result")

type wakeReturn struct {
	ID          string
	Origin      *Engine
	OriginKey   string
	DestProject string
	DestKey     string
	Status      string // accepted → completed | failed
	Text        string
	Error       string
}

// maxWakeReturns bounds the process-local records; the oldest settled ones go first.
const maxWakeReturns = 1024

var wakeReturns = struct {
	mu    sync.Mutex
	byID  map[string]*wakeReturn
	order []string
}{byID: map[string]*wakeReturn{}}

// deliverWakeReturn runs the result as one silent turn in the origin session.
func deliverWakeReturn(w wakeReturn) {
	if err := w.Origin.ExecuteHeartbeat(w.OriginKey, wakeReturnPrompt(w), true); err != nil {
		slog.Warn("wake: result not delivered to the waking session", "wake_id", w.ID, "project", w.Origin.name, "session", w.OriginKey, "error", err)
		return
	}
	slog.Info("wake: result delivered to the waking session", "wake_id", w.ID, "project", w.Origin.name, "session", w.OriginKey, "status", w.Status)
}

func registerWakeReturn(origin *Engine, originKey, destProject, destKey string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	id := "wk_" + hex.EncodeToString(b)
	wakeReturns.mu.Lock()
	defer wakeReturns.mu.Unlock()
	for len(wakeReturns.order) >= maxWakeReturns {
		old := wakeReturns.order[0]
		wakeReturns.order = wakeReturns.order[1:]
		delete(wakeReturns.byID, old)
	}
	wakeReturns.byID[id] = &wakeReturn{ID: id, Origin: origin, OriginKey: originKey, DestProject: destProject, DestKey: destKey, Status: "accepted"}
	wakeReturns.order = append(wakeReturns.order, id)
	return id
}

// settleWakeReturn records the woken turn's outcome once and hands it to the origin.
// Later calls for the same wake (a turn's fallback paths) do nothing.
func settleWakeReturn(id, text string, runErr error) {
	if id == "" {
		return
	}
	wakeReturns.mu.Lock()
	w := wakeReturns.byID[id]
	if w == nil || w.Status != "accepted" {
		wakeReturns.mu.Unlock()
		return
	}
	if runErr != nil {
		w.Status, w.Error = "failed", runErr.Error()
	} else {
		w.Status, w.Text = "completed", strings.TrimSpace(text)
	}
	snap := *w
	wakeReturns.mu.Unlock()
	go deliverWakeReturn(snap)
}

func wakeReturnPrompt(w wakeReturn) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[wake result %s] The session you woke (project %s, session %s) has %s.\n", w.ID, w.DestProject, w.DestKey, w.Status)
	switch {
	case w.Status == "failed":
		fmt.Fprintf(&b, "Error: %s\n", w.Error)
	case w.Text == "":
		b.WriteString("It finished without a visible reply.\n")
	default:
		b.WriteString("Its final reply:\n" + w.Text + "\n")
	}
	b.WriteString("Pass this result on to this conversation.")
	return b.String()
}
