package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// GeneralSessionKey is shared by the room's projects. Each project resolves
// it in its own session manager.
const GeneralSessionKey = "general:general"

var errGeneralEmptyMessage = errors.New("General message must include text")

type GeneralMessage struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	AuthorID  string    `json:"author_id"`
	Author    string    `json:"author"`
	Text      string    `json:"text"`
	ReplyTo   string    `json:"reply_to,omitempty"`
	Target    string    `json:"target,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type GeneralRoomMember struct {
	Project     string `json:"project"`
	DisplayName string `json:"display_name"`
}

// GeneralRoom owns the shared transcript and the running projects that joined it.
type GeneralRoom struct {
	mu      sync.Mutex
	path    string
	history []GeneralMessage
	members map[string]generalMember
	changed chan struct{}
}

type generalMember struct {
	platform *generalPlatform
	handle   MessageHandler
}

func NewGeneralRoom(dataDir string) (*GeneralRoom, error) {
	dir := filepath.Join(dataDir, "general")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create General data directory: %w", err)
	}
	room := &GeneralRoom{
		path:    filepath.Join(dir, "messages.json"),
		history: []GeneralMessage{},
		members: make(map[string]generalMember),
		changed: make(chan struct{}),
	}
	data, err := os.ReadFile(room.path)
	if os.IsNotExist(err) {
		return room, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read General transcript: %w", err)
	}
	if err := json.Unmarshal(data, &room.history); err != nil {
		return nil, fmt.Errorf("decode General transcript: %w", err)
	}
	return room, nil
}

func (r *GeneralRoom) Platform(project, displayName string) Platform {
	return &generalPlatform{room: r, project: project, displayName: displayName}
}

func (r *GeneralRoom) History() []GeneralMessage {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.history)
}

func (r *GeneralRoom) Members() []GeneralRoomMember {
	r.mu.Lock()
	defer r.mu.Unlock()
	members := make([]GeneralRoomMember, 0, len(r.members))
	for _, project := range slices.Sorted(maps.Keys(r.members)) {
		members = append(members, GeneralRoomMember{
			Project: project, DisplayName: r.members[project].platform.displayName,
		})
	}
	return members
}

// messagesAfter takes the replay snapshot and its wake-up signal together so
// a post between replay and waiting cannot go unnoticed.
func (r *GeneralRoom) messagesAfter(after int) ([]GeneralMessage, <-chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if after > len(r.history) {
		return nil, nil
	}
	return slices.Clone(r.history[after:]), r.changed
}

// PostUserMessage accepts text from an authenticated native room client.
func (r *GeneralRoom) PostUserMessage(userID, name, text string) error {
	_, err := r.postUserMessage(userID, name, text)
	return err
}

func (r *GeneralRoom) postUserMessage(userID, name, text string) (GeneralMessage, error) {
	if strings.TrimSpace(text) == "" {
		return GeneralMessage{}, errGeneralEmptyMessage
	}
	return r.post(GeneralMessage{Kind: "user", AuthorID: userID, Author: name, Text: text})
}

func (r *GeneralRoom) post(message GeneralMessage) (GeneralMessage, error) {
	r.mu.Lock()
	message.ID = strconv.Itoa(len(r.history) + 1)
	message.CreatedAt = time.Now().UTC()
	var target generalMember
	if message.Kind != "notice" {
		message.Target, target = r.addressedMember(message.Text)
		if message.Kind == "agent" && message.Target == message.AuthorID {
			message.Target, target = "", generalMember{}
		}
	}
	next := append(r.history, message)
	data, err := json.Marshal(next)
	if err != nil {
		r.mu.Unlock()
		return GeneralMessage{}, fmt.Errorf("encode General transcript: %w", err)
	}
	if err := AtomicWriteFile(r.path, data, 0o600); err != nil {
		r.mu.Unlock()
		return GeneralMessage{}, fmt.Errorf("save General transcript: %w", err)
	}
	r.history = next
	close(r.changed)
	r.changed = make(chan struct{})
	var instructions string
	if target.handle != nil {
		members := slices.Sorted(maps.Keys(r.members))
		instructions = "You are in the General room. Other room members can read your reply. " +
			"To ask a teammate to take a turn, begin your final reply with @ followed by their project name. " +
			"Project names in General: " + strings.Join(members, ", ") + "."
	}
	r.mu.Unlock()

	if target.handle != nil {
		senderID := message.AuthorID
		if message.Kind == "agent" {
			senderID = "project:" + senderID
		}
		target.handle(target.platform, &Message{
			SessionKey:   GeneralSessionKey,
			Platform:     target.platform.Name(),
			MessageID:    message.ID,
			ChannelID:    "general",
			ChatName:     "General",
			UserID:       senderID,
			UserName:     message.Author,
			Content:      message.Text,
			ExtraContent: instructions,
			ReplyCtx:     generalReplyContext{messageID: message.ID},
			Mentioned:    true,
			FromBot:      message.Kind == "agent",
			GroupChat:    true,
		})
	}
	return message, nil
}

// addressedMember matches a leading @project name against room membership.
// Longest matches win when a project name is a prefix of another.
func (r *GeneralRoom) addressedMember(text string) (string, generalMember) {
	address, ok := strings.CutPrefix(strings.TrimSpace(text), "@")
	if !ok {
		return "", generalMember{}
	}
	var project string
	for name := range r.members {
		rest, ok := strings.CutPrefix(address, name)
		if !ok || len(name) <= len(project) {
			continue
		}
		next, _ := utf8.DecodeRuneInString(rest)
		if rest == "" || unicode.IsSpace(next) || strings.ContainsRune(",，:：", next) {
			project = name
		}
	}
	return project, r.members[project]
}

type generalPlatform struct {
	room        *GeneralRoom
	project     string
	displayName string
}

type generalReplyContext struct {
	messageID string
	draft     bool
}

func (p *generalPlatform) Name() string { return "general" }

func (p *generalPlatform) Start(handler MessageHandler) error {
	p.room.mu.Lock()
	defer p.room.mu.Unlock()
	p.room.members[p.project] = generalMember{platform: p, handle: handler}
	return nil
}

func (p *generalPlatform) Stop() error {
	p.room.mu.Lock()
	defer p.room.mu.Unlock()
	if p.room.members[p.project].platform == p {
		delete(p.room.members, p.project)
	}
	return nil
}

func (p *generalPlatform) Reply(_ context.Context, replyCtx any, text string) error {
	rc := replyCtx.(generalReplyContext)
	if rc.draft {
		return nil
	}
	_, err := p.room.post(GeneralMessage{
		Kind: "notice", AuthorID: p.project, Author: p.displayName, Text: text, ReplyTo: rc.messageID,
	})
	return err
}

func (p *generalPlatform) Send(ctx context.Context, replyCtx any, text string) error {
	return p.Reply(ctx, replyCtx, text)
}

func (p *generalPlatform) MarkAgentReply(replyCtx any) any {
	rc := replyCtx.(generalReplyContext)
	rc.draft = true
	return rc
}

func (p *generalPlatform) ReplyFinalText(_ context.Context, replyCtx any, text string) error {
	rc := replyCtx.(generalReplyContext)
	_, err := p.room.post(GeneralMessage{
		Kind: "agent", AuthorID: p.project, Author: p.displayName, Text: text, ReplyTo: rc.messageID,
	})
	return err
}
