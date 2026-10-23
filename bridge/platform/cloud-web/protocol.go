package cloudweb

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

const (
	protocolVersion = 1
	defaultWSPath   = "/cloud-web/ws"
	defaultEvents   = "/cloud-web/v1/events"
	defaultSend     = "/cloud-web/v1/send"
	defaultRegister = "/cloud-web/v1/register"
)

const (
	capText             = "text"
	capImage            = "image"
	capFile             = "file"
	capAudio            = "audio"
	capCard             = "card"
	capButtons          = "buttons"
	capTyping           = "typing"
	capUpdateMessage    = "update_message"
	capPreview          = "preview"
	capDeleteMessage    = "delete_message"
	capReconstructReply = "reconstruct_reply"
	// maomao fork: the gateway renders the sub-agent table payload
	// (core.SubTaskTablePayloadPrefix). Without it the table is not sent.
	capSubTaskTable = "subtask_table"
	// maomao fork (#121): a reply frame with preview_handle overwrites that streamed
	// preview and is then relayed like any reply. Enables text stream previews.
	capReplyInPlace = "reply_in_place"
	// Team mode E: the gateway answers team_workspace frames (list a chat room's workspaces,
	// create the next one). Only on when the gateway lists it: not in allCapabilities, so an
	// older gateway that sends no capability list never gets these frames.
	capTeamWorkspace = "team_workspace"
)

var allCapabilities = []string{
	capText, capImage, capFile, capAudio, capCard, capButtons,
	capTyping, capUpdateMessage, capPreview, capDeleteMessage, capReconstructReply, capSubTaskTable, capReplyInPlace,
}

func capabilitySet(list []string) map[string]bool {
	caps := make(map[string]bool, len(list)+1)
	for _, c := range list {
		c = strings.TrimSpace(c)
		if c != "" {
			caps[c] = true
		}
	}
	caps[capText] = true
	return caps
}

func defaultCapabilities() map[string]bool {
	return capabilitySet(allCapabilities)
}

func cloneCapabilities(c map[string]bool) map[string]bool {
	if c == nil {
		return nil
	}
	out := make(map[string]bool, len(c))
	for k, v := range c {
		out[k] = v
	}
	return out
}

func deriveBaseURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

type wireMsg struct {
	Type string `json:"type"`
}

type wireRegister struct {
	Type      string         `json:"type"`
	Platform  string         `json:"platform"`
	Client    string         `json:"client"`
	Project   string         `json:"project,omitempty"`
	Transport string         `json:"transport"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type wireRegisterAck struct {
	Type         string         `json:"type"`
	OK           bool           `json:"ok"`
	Error        string         `json:"error,omitempty"`
	Capabilities []string       `json:"capabilities,omitempty"`
	Server       map[string]any `json:"server,omitempty"`
}

type wireImage struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
	FileName string `json:"file_name,omitempty"`
}

type wireFile struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
	FileName string `json:"file_name"`
}

type wireAudio struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
	Format   string `json:"format"`
	Duration int    `json:"duration,omitempty"`
}

type wireInboundMessage struct {
	Type       string      `json:"type"`
	MsgID      string      `json:"msg_id"`
	SessionKey string      `json:"session_key"`
	ChatID     string      `json:"chat_id,omitempty"`
	UserID     string      `json:"user_id"`
	UserName   string      `json:"user_name,omitempty"`
	Content    string      `json:"content"`
	ReplyCtx   string      `json:"reply_ctx"`
	ChatType   string      `json:"chat_type,omitempty"`
	Mentioned  *bool       `json:"mentioned,omitempty"`
	Images     []wireImage `json:"images,omitempty"`
	Files      []wireFile  `json:"files,omitempty"`
	Audio      *wireAudio  `json:"audio,omitempty"`
	// FromBot (maomao fork): sent by a teammate bot. Like Discord, the gate only lets it start
	// a turn when Mentioned; otherwise it is listen-only context (core/gate.go applyGate).
	FromBot bool `json:"from_bot,omitempty"`
	// ChatName (maomao fork): the channel's display name, for the team status block (core/team.go).
	ChatName string `json:"chat_name,omitempty"`
	// UserMentionID (maomao fork): the sending bot's <@id>; matched against team_lead_bot to know the
	// lead dispatched this turn (lead_return.go), as Discord matches the author ID.
	UserMentionID string `json:"user_mention_id,omitempty"`
	// LeadID is supplied by the DSH channel host when it has a primary-role
	// selection. A pointer distinguishes an old gateway from an explicit empty
	// selection (no routable role yet).
	LeadID *string `json:"lead_id,omitempty"`
}

type wireCardAction struct {
	Type       string `json:"type"`
	SessionKey string `json:"session_key"`
	Action     string `json:"action"`
	ReplyCtx   string `json:"reply_ctx"`
}

type wireMessageRecall struct {
	Type       string `json:"type"`
	SessionKey string `json:"session_key"`
	MsgID      string `json:"msg_id"`
}

type wirePreviewAck struct {
	Type          string `json:"type"`
	RefID         string `json:"ref_id"`
	PreviewHandle string `json:"preview_handle"`
}

type wireCapabilitiesChanged struct {
	Type         string   `json:"type"`
	Capabilities []string `json:"capabilities"`
}

type replyContext struct {
	SessionKey string
	ReplyCtx   string
	Agent      bool // maomao fork: carries agent output (core.AgentReplyMarker, history.go)
	// maomao fork (lead_return.go, same as platform/discord replyContext): the trigger message,
	// the team lead that @-ed this sub to start the turn, and whether this send is the final answer.
	MsgID string
	lead  string
	final bool
}

func authHTTP(req *http.Request, token string) {
	if token == "" {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Cloud-Web-Token", token)
}

func joinURL(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if path == "" {
		return base
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

func buildRegisterPayload(name, project, transport string) wireRegister {
	return wireRegister{
		Type:      "register",
		Platform:  name,
		Client:    "bothouse",
		Project:   project,
		Transport: transport,
		Metadata: map[string]any{
			"protocol_version": protocolVersion,
		},
	}
}

func parseRegisterAck(raw []byte) (map[string]bool, error) {
	var ack wireRegisterAck
	if err := json.Unmarshal(raw, &ack); err != nil {
		return nil, fmt.Errorf("cloud_web: parse register_ack: %w", err)
	}
	if ack.Type != "register_ack" {
		return nil, fmt.Errorf("cloud_web: expected register_ack, got %q", ack.Type)
	}
	if !ack.OK {
		if ack.Error != "" {
			return nil, fmt.Errorf("cloud_web: register rejected: %s", ack.Error)
		}
		return nil, fmt.Errorf("cloud_web: register rejected")
	}
	if len(ack.Capabilities) == 0 {
		return defaultCapabilities(), nil
	}
	return capabilitySet(ack.Capabilities), nil
}

func decodeImages(items []wireImage) []core.ImageAttachment {
	var out []core.ImageAttachment
	for _, img := range items {
		data, err := base64.StdEncoding.DecodeString(img.Data)
		if err != nil {
			slog.Debug("cloud_web: invalid image base64", "error", err)
			continue
		}
		out = append(out, core.ImageAttachment{
			MimeType: img.MimeType,
			Data:     data,
			FileName: img.FileName,
		})
	}
	return out
}

func decodeFiles(items []wireFile) []core.FileAttachment {
	var out []core.FileAttachment
	for _, f := range items {
		data, err := base64.StdEncoding.DecodeString(f.Data)
		if err != nil {
			slog.Debug("cloud_web: invalid file base64", "error", err)
			continue
		}
		out = append(out, core.FileAttachment{
			MimeType: f.MimeType,
			Data:     data,
			FileName: f.FileName,
		})
	}
	return out
}

func decodeAudio(a *wireAudio) *core.AudioAttachment {
	if a == nil {
		return nil
	}
	data, err := base64.StdEncoding.DecodeString(a.Data)
	if err != nil {
		slog.Debug("cloud_web: invalid audio base64", "error", err)
		return nil
	}
	return &core.AudioAttachment{
		MimeType: a.MimeType,
		Data:     data,
		Format:   a.Format,
		Duration: a.Duration,
	}
}

func buildSessionKey(platformName, chatID, userID string, shareInChannel bool, provided string) string {
	if strings.TrimSpace(provided) != "" {
		return provided
	}
	chatID = strings.TrimSpace(chatID)
	userID = strings.TrimSpace(userID)
	if chatID == "" {
		chatID = userID
	}
	if shareInChannel {
		return fmt.Sprintf("%s:%s", platformName, chatID)
	}
	return fmt.Sprintf("%s:%s:%s", platformName, chatID, userID)
}

func isGroupChat(chatType string) bool {
	switch strings.ToLower(strings.TrimSpace(chatType)) {
	case "group", "channel", "room":
		return true
	default:
		return false
	}
}

// Team mode E (user 2026-10-24 01:26「应该支持我们现有的dsh，discord，飞书，自建平台」): the
// gateway owns the rooms, so the bridge asks it instead of keeping its own copy.
//
//	→ {"type":"team_workspace","ref_id":"tw-…","op":"list"|"create","session_key":"<platform>:room-<id>",
//	   "chat_id":"room-<id>","reply_ctx":"room-<id>","name":"工作区2"}
//	← {"type":"team_workspace_ack","ref_id":"tw-…","ok":true,
//	   "self":{"id":"room-<id>","name":"…"},"rooms":[…],   // list: the room and its workspaces
//	   "room":{"id":"room-<id>","name":"工作区2"}}        // create: the new workspace
//	← {"type":"team_workspace_ack","ref_id":"tw-…","ok":false,"error":"unsupported"|"not_team_channel"|"room-missing"|…}
//
// "rooms" only lists the room's own workspaces (the gateway's parent relation, e.g. collab's
// rooms.parent_id), so core numbers and adopts from what the gateway recorded.
const (
	typeTeamWorkspace    = "team_workspace"
	typeTeamWorkspaceAck = "team_workspace_ack"
)

type wireTeamWorkspaceRoom struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type wireTeamWorkspaceAck struct {
	Type  string                  `json:"type"`
	RefID string                  `json:"ref_id"`
	OK    bool                    `json:"ok"`
	Error string                  `json:"error,omitempty"`
	Self  *wireTeamWorkspaceRoom  `json:"self,omitempty"`
	Rooms []wireTeamWorkspaceRoom `json:"rooms,omitempty"`
	Room  *wireTeamWorkspaceRoom  `json:"room,omitempty"`
}
