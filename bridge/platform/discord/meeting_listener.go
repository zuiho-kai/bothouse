package discord

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// The voice listener of the meeting assistant (meeting.go): contrib/discord-voice, a Node
// process that holds the voice connection and transcribes. Its files are built into the binary,
// released into <data_dir>/discord-voice and its npm dependencies are installed there once.
// Protocol (JSON lines) is described at the top of contrib/discord-voice/listener.mjs.

// VoiceListenerFS holds contrib/discord-voice (embed_voice.go; set by cmd/cc-connect).
var VoiceListenerFS fs.FS

const voiceListenerSrc = "contrib/discord-voice"

var voiceListenerFiles = []string{"listener.mjs", "video.mjs", "golive.mjs", "asr_worker.py", "package.json"}

var voiceListenerInstallMu sync.Mutex

// source: Discord gateway opcodes, 4 = Voice State Update (the only payload a voice library sends)
const discordVoiceStateUpdateOp = 4

type listenerEvent struct {
	Op      string `json:"op"`
	UserID  string `json:"user_id"`
	Start   int64  `json:"start"` // epoch ms
	End     int64  `json:"end"`
	Text    string `json:"text"`
	Message string `json:"message"`
	Kind    string `json:"kind"` // frame: "camera" or "screen"
	At      int64  `json:"at"`   // frame: epoch ms
	JPG     []byte `json:"jpg"`  // frame: the still (base64 in the JSON line)
	D       struct {
		Op int `json:"op"`
		D  struct {
			ChannelID *string `json:"channel_id"`
			SelfMute  bool    `json:"self_mute"`
			SelfDeaf  bool    `json:"self_deaf"`
		} `json:"d"`
	} `json:"d"`
}

type voiceListener struct {
	cmd     *exec.Cmd
	mu      sync.Mutex
	stdin   io.WriteCloser
	drained chan struct{} // every event it wrote has been handled (its stdout is at EOF)
	exited  chan struct{} // drained, and the process is gone
}

func (l *voiceListener) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, err = l.stdin.Write(append(b, '\n'))
	return err
}

func (l *voiceListener) kill() {
	if l == nil || l.cmd == nil || l.cmd.Process == nil {
		return
	}
	_ = l.cmd.Process.Kill()
}

// waitExit waits for the listener to exit by itself. After limit it kills it and waits only for
// the events it had already written, so a stuck listener cannot hold the meeting. It reports
// whether the listener exited by itself.
func (l *voiceListener) waitExit(limit time.Duration) bool {
	t := time.NewTimer(limit)
	defer t.Stop()
	select {
	case <-l.exited:
		return true
	case <-t.C:
	}
	l.kill()
	// not l.exited: a transcriber that hangs keeps the stderr pipe open after the listener is dead
	<-l.drained
	return false
}

func expandHomePath(p string) string {
	if rest, ok := strings.CutPrefix(p, "~/"); ok {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, rest)
		}
	}
	return p
}

func (p *Platform) voiceListenerDir() (string, error) {
	if p.meetingDataDir != "" {
		return filepath.Join(p.meetingDataDir, "discord-voice"), nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "bothouse", "discord-voice"), nil
}

// ensureVoiceListener releases the listener into dir and installs its npm dependencies when
// they are missing or package.json changed. It returns the node to run it with.
func ensureVoiceListener(dir string) (string, error) {
	voiceListenerInstallMu.Lock()
	defer voiceListenerInstallMu.Unlock()
	if VoiceListenerFS == nil {
		return "", errors.New("这个版本没有带语音组件")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return "", errors.New("没找到 node，会议助手需要 Node.js 22.12 或更新的版本")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	var pkg []byte
	for _, name := range voiceListenerFiles {
		b, err := fs.ReadFile(VoiceListenerFS, voiceListenerSrc+"/"+name)
		if err != nil {
			return "", err
		}
		if name == "package.json" {
			pkg = b
		}
		if err := core.AtomicWriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			return "", err
		}
	}
	sum := sha256.Sum256(pkg)
	want := hex.EncodeToString(sum[:])
	marker := filepath.Join(dir, "installed.sha256")
	if got, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(got)) == want {
		if _, err := os.Stat(filepath.Join(dir, "node_modules", "@discordjs", "voice", "package.json")); err == nil {
			return node, nil
		}
	}
	npm, err := exec.LookPath("npm")
	if err != nil {
		return "", errors.New("没找到 npm，装不了语音组件的依赖")
	}
	slog.Info("discord: installing the voice listener's dependencies", "dir", dir)
	cmd := exec.Command(npm, "install", "--no-audit", "--no-fund", "--omit=dev")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		tail := strings.TrimSpace(string(out))
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		return "", fmt.Errorf("语音组件的依赖没装上（npm install：%v）%s", err, tail)
	}
	if err := core.AtomicWriteFile(marker, []byte(want+"\n"), 0o644); err != nil {
		return "", err
	}
	slog.Info("discord: voice listener ready", "dir", dir)
	return node, nil
}

// prepareVoiceListener installs the listener ahead of the first meeting (Start).
func (p *Platform) prepareVoiceListener() {
	dir, err := p.voiceListenerDir()
	if err == nil {
		_, err = ensureVoiceListener(dir)
	}
	if err != nil {
		slog.Warn("discord: meeting assistant is on but the voice listener is not ready", "error", err)
	}
}

// startVoiceListener runs the listener for one meeting and feeds its events to onListenerEvent.
func (p *Platform) startVoiceListener(mt *meeting) (*voiceListener, error) {
	dir, err := p.voiceListenerDir()
	if err != nil {
		return nil, err
	}
	node, err := ensureVoiceListener(dir)
	if err != nil {
		return nil, err
	}
	python := expandHomePath(p.meetingASRPython)
	if _, err := exec.LookPath(python); err != nil {
		return nil, fmt.Errorf("没找到转写用的 python（meeting_asr_python = %s）", p.meetingASRPython)
	}
	cmd := exec.Command(node, filepath.Join(dir, "listener.mjs"), python)
	cmd.Dir = dir
	if p.meetingScreenToken != "" { // env, not argv: other local users can read a process's arguments
		cmd.Env = append(os.Environ(), "BOTHOUSE_SCREEN_TOKEN="+p.meetingScreenToken)
	}
	return p.runVoiceListener(mt, cmd)
}

// runVoiceListener starts cmd as the listener of mt and feeds its events to onListenerEvent.
func (p *Platform) runVoiceListener(mt *meeting, cmd *exec.Cmd) (*voiceListener, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	l := &voiceListener{cmd: cmd, stdin: stdin, drained: make(chan struct{}), exited: make(chan struct{})}
	var readers sync.WaitGroup
	readers.Add(2)
	go func() {
		defer readers.Done()
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			slog.Debug("discord: voice listener", "guild", mt.guildID, "line", sc.Text())
		}
	}()
	go func() {
		defer readers.Done()
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for sc.Scan() {
			var ev listenerEvent
			if err := json.Unmarshal(sc.Bytes(), &ev); err != nil {
				continue
			}
			p.onListenerEvent(mt, ev)
		}
		close(l.drained)
	}()
	go func() {
		readers.Wait() // every event is handled before the meeting is told the listener is gone
		err := cmd.Wait()
		slog.Info("discord: voice listener exited", "guild", mt.guildID, "error", err)
		close(l.exited)
	}()
	return l, nil
}
