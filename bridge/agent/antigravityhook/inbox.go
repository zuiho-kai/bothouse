package antigravityhook

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Mid-turn input for Antigravity (agy). agy's own stdin cannot join a running turn: a second
// stream-json "user" event is answered as a turn of its own after the running one (agy 1.5.3,
// tested 2026-11-10). Its hooks can: PreInvocation runs before every model call of a turn and may
// inject a userMessage step, and Stop may answer "continue" so the turn goes on. So the bridge
// drops a message sent while the turn runs into the session's inbox directory (EnvInbox in the agy
// process environment), and the role's hook (InboxHookName in <work_dir>/.agents/hooks.json, which
// runs "bothouse _agy-inbox-hook <event>") hands it to the turn at its next model call, or keeps
// the turn going when it was about to end.
//
// Once the Stop hook let the turn end with an empty inbox it marks the inbox closed, under the same
// lock as Put: a message that arrives after that point fails with ErrTurnEnding and the bridge
// queues it for the next turn, instead of leaving it in an inbox nobody reads. Open (turn start)
// clears the mark; anything still in the inbox then goes into that turn at its first model call.
const (
	EnvInbox      = "BOTHOUSE_AGY_INBOX"
	InboxHookName = "bothouse-inbox"
	InboxHookArg  = "_agy-inbox-hook"

	inboxLock   = ".lock"
	inboxClosed = "closed"
	inboxExt    = ".msg"
)

// ErrTurnEnding: the running turn already decided to end; the message must be queued.
var ErrTurnEnding = errors.New("agy inbox: the turn is ending")

// errLockUnsupported: no cross-process lock on this platform (Windows); mid-turn input is off.
var errLockUnsupported = errors.New("agy inbox: file lock not supported on this platform")

// InboxSupported reports whether mid-turn input works on this platform.
func InboxSupported() bool { return lockSupported }

// Inbox is one session's inbox directory.
type Inbox struct{ Dir string }

var inboxSeq atomic.Int64

// NewInbox creates a fresh inbox directory under parent.
func NewInbox(parent string) (*Inbox, error) {
	if !lockSupported {
		return nil, errLockUnsupported
	}
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp(parent, "s-")
	if err != nil {
		return nil, err
	}
	return &Inbox{Dir: dir}, nil
}

// Open starts a turn: messages may be put again.
func (b *Inbox) Open() error {
	unlock, err := lockDir(b.Dir)
	if err != nil {
		return err
	}
	defer unlock()
	if err := os.Remove(filepath.Join(b.Dir, inboxClosed)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Put adds one message for the running turn; ErrTurnEnding once its Stop hook let it end.
func (b *Inbox) Put(text string) error {
	unlock, err := lockDir(b.Dir)
	if err != nil {
		return err
	}
	defer unlock()
	if _, err := os.Stat(filepath.Join(b.Dir, inboxClosed)); err == nil {
		return ErrTurnEnding
	}
	name := fmt.Sprintf("%020d-%06d", time.Now().UnixNano(), inboxSeq.Add(1)%1000000)
	tmp := filepath.Join(b.Dir, "."+name+".tmp")
	if err := os.WriteFile(tmp, []byte(text), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(b.Dir, name+inboxExt)); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// Pending returns how many messages wait in the inbox.
func (b *Inbox) Pending() int {
	m, _ := filepath.Glob(filepath.Join(b.Dir, "*"+inboxExt))
	return len(m)
}

// Remove deletes the inbox directory (session closed).
func (b *Inbox) Remove() error { return os.RemoveAll(b.Dir) }

// take removes and returns the waiting messages, oldest first. closeIfEmpty marks the inbox closed
// when there are none (the Stop hook lets the turn end).
func (b *Inbox) take(closeIfEmpty bool) ([]string, error) {
	unlock, err := lockDir(b.Dir)
	if err != nil {
		return nil, err
	}
	defer unlock()
	names, _ := filepath.Glob(filepath.Join(b.Dir, "*"+inboxExt))
	sort.Strings(names)
	var msgs []string
	for _, n := range names {
		data, err := os.ReadFile(n)
		if err != nil {
			continue
		}
		_ = os.Remove(n)
		if s := strings.TrimSpace(string(data)); s != "" {
			msgs = append(msgs, s)
		}
	}
	if len(msgs) == 0 && closeIfEmpty {
		if err := os.WriteFile(filepath.Join(b.Dir, inboxClosed), []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0o600); err != nil {
			return nil, err
		}
	}
	return msgs, nil
}

// stopReasonHead introduces messages the Stop hook hands over: agy injects the reason as a
// system message, so say plainly that these are the people in the chat, not the system.
const stopReasonHead = "（这一轮还在进行时，聊天里又发来了新消息，由 bothouse 原样转来，等同用户亲自发的消息。先照它们回应或调整，再结束这一轮。）"

// RunInboxHook is the "_agy-inbox-hook <event>" command: it answers agy's PreInvocation or Stop
// hook from the inbox named by EnvInbox. Any failure answers "go on as usual", never an error:
// a broken inbox must not stop the turn.
func RunInboxHook(event string, in io.Reader, out io.Writer, dir string) error {
	_, _ = io.Copy(io.Discard, io.LimitReader(in, maxHookInput))
	stop := event == "Stop"
	pass := func() error {
		if stop {
			_, err := io.WriteString(out, `{"decision":"allow"}`+"\n")
			return err
		}
		_, err := io.WriteString(out, "{}\n")
		return err
	}
	if dir == "" {
		return pass()
	}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return pass()
	}
	msgs, err := (&Inbox{Dir: dir}).take(stop)
	if err != nil || len(msgs) == 0 {
		_ = pass()
		return err
	}
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	if stop {
		return enc.Encode(map[string]string{"decision": "continue", "reason": stopReasonHead + "\n\n" + strings.Join(msgs, "\n\n")})
	}
	steps := make([]map[string]string, 0, len(msgs))
	for _, m := range msgs {
		steps = append(steps, map[string]string{"userMessage": m})
	}
	return enc.Encode(map[string]any{"injectSteps": steps})
}
