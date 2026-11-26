package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	ccconnect "github.com/chenhg5/cc-connect"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

func runSend(args []string) {
	// A lone "help" is a usage request, not a message (send it with --message help).
	if len(args) == 1 && isHelpArg(args[0]) {
		printSendUsage()
		return
	}
	req, dataDir, err := parseSendArgs(args)
	if err != nil {
		if errors.Is(err, errSendUsage) {
			printSendUsage()
			return
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		printSendUsage()
		os.Exit(1)
	}

	sockPath := resolveSocketPath(dataDir)
	if _, err := os.Stat(sockPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: bothouse is not running (socket not found: %s)\n", sockPath)
		os.Exit(1)
	}

	payload, err := buildSendPayload(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to encode send payload: %v\n", err)
		os.Exit(1)
	}

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return dialBridge(ctx, sockPath)
			},
		},
	}

	resp, err := client.Post("http://unix/send", "application/json", bytes.NewReader(payload))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusAccepted || resp.StatusCode == http.StatusOK {
		if note := crossBotSendNote(req.Project, os.Getenv("CC_PROJECT")); note != "" {
			defer fmt.Println(note)
		}
	}
	if resp.StatusCode == http.StatusAccepted {
		fmt.Println(string(body))
		return
	}
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Error: %s\n", strings.TrimSpace(string(body)))
		os.Exit(1)
	}

	var ok struct {
		Note        string `json:"note"`
		ChannelID   string `json:"channel_id"`
		ChannelName string `json:"channel_name"`
	}
	if json.Unmarshal(body, &ok) == nil && ok.Note != "" {
		fmt.Println("Message sent. " + ok.Note)
		return
	}
	// The receipt tells the model the reader already has it, so the turn's closing reply does not
	// describe the send step or say the same thing again (the bridge no longer edits such
	// sentences out of the reply; it only drops a reply identical to what was already sent).
	if ok.ChannelName != "" {
		// Where it really went: the role reports this name, not the one it meant to send to.
		fmt.Printf("已发到 #%s（%s）。对方已收到，不要在回复里复述这条内容或发送过程。\n", ok.ChannelName, ok.ChannelID)
		return
	}
	fmt.Println("Message sent successfully. It is delivered; do not restate it or narrate the send in your reply.")
}

var errSendUsage = errors.New("show send usage")

// crossBotSendNote: a role that sends with -p <another bot> posts in that bot's name; the bot
// itself is not woken and starts no turn. The plain "sent" receipt read as "assigned" (外部用户
// 11-25 报告 #1997: a DSH lead "assigned" three members with send -p, none of them started), so
// the receipt says what really happened and how work is handed over instead.
func crossBotSendNote(target, caller string) string {
	target, caller = strings.TrimSpace(target), strings.TrimSpace(caller)
	if target == "" || caller == "" || target == caller {
		return ""
	}
	return fmt.Sprintf("注意：这条是以「%s」的身份发出的，%s 不会因此被叫醒、也不会开工。要派活就在频道里 @ 它，或开工作区交给它。", target, target)
}

func parseSendArgs(args []string) (core.SendRequest, string, error) {
	var req core.SendRequest
	var dataDir string
	var useStdin bool
	var imagePaths []string
	var filePaths []string
	var audioPaths []string
	var videoPaths []string
	var positional []string

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--task", "--revision", "--delivery-id", "--text-kind":
			flag := args[i]
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("%s requires a value", flag)
			}
			i++
			if req.TaskText == nil {
				req.TaskText = &core.TaskTextRequest{Kind: "result"}
			}
			switch flag {
			case "--task":
				req.TaskText.TaskID = args[i]
			case "--delivery-id":
				req.TaskText.DeliveryID = args[i]
			case "--text-kind":
				req.TaskText.Kind = args[i]
			case "--revision":
				n, err := strconv.Atoi(args[i])
				if err != nil || n < 1 {
					return req, "", fmt.Errorf("positive revision required")
				}
				req.TaskText.Revision = n
			}
		case "--project", "-p":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--project requires a value")
			}
			i++
			req.Project = args[i]
		case "--session", "-s":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--session requires a value")
			}
			i++
			req.SessionKey = args[i]
		case "--channel":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--channel requires a channel name")
			}
			i++
			req.Channel = strings.TrimSpace(args[i])
			if req.Channel == "" {
				return req, "", fmt.Errorf("--channel requires a channel name")
			}
		case "--message", "-m":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--message requires a value")
			}
			i++
			req.Message = args[i]
		case "--reply-to":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--reply-to requires a message ID")
			}
			i++
			req.ReplyToMessageID = args[i]
			if strings.TrimSpace(req.ReplyToMessageID) == "" {
				return req, "", fmt.Errorf("--reply-to requires a message ID")
			}
		case "--cwd", "--work-dir":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("%s requires a value", args[i])
			}
			i++
			req.WorkDir = args[i]
		case "--tts":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("%s requires a value", args[i])
			}
			i++
			req.TTSText = args[i]
		case "--image":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--image requires a path")
			}
			i++
			imagePaths = append(imagePaths, args[i])
		case "--file":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--file requires a path")
			}
			i++
			filePaths = append(filePaths, args[i])
		case "--audio":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--audio requires a path")
			}
			i++
			audioPaths = append(audioPaths, args[i])
		case "--video":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--video requires a path")
			}
			i++
			videoPaths = append(videoPaths, args[i])
		case "--stdin":
			useStdin = true
		case "--at-users":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--at-users requires a value")
			}
			i++
			for _, uid := range strings.Split(args[i], ",") {
				uid = strings.TrimSpace(uid)
				if uid != "" {
					req.AtUsers = append(req.AtUsers, uid)
				}
			}
		case "--at-all":
			req.AtAll = true
		case "--dm":
			req.DM = true
		case "--experience":
			req.Experience = true
		case "--mention-assigner":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--mention-assigner requires a task board ID")
			}
			i++
			n, err := strconv.Atoi(strings.TrimPrefix(strings.TrimSpace(args[i]), "#"))
			if err != nil || n <= 0 {
				return req, "", fmt.Errorf("--mention-assigner requires a task board ID")
			}
			req.MentionAssigner = n
		case "--board-id":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--board-id requires a task board ID")
			}
			i++
			n, err := strconv.Atoi(strings.TrimPrefix(strings.TrimSpace(args[i]), "#"))
			if err != nil || n <= 0 {
				return req, "", fmt.Errorf("--board-id requires a task board ID")
			}
			req.BoardID = n
		case "--for":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--for requires a task board ID")
			}
			i++
			n, err := strconv.Atoi(strings.TrimPrefix(strings.TrimSpace(args[i]), "#"))
			if err != nil || n <= 0 {
				return req, "", fmt.Errorf("--for requires a task board ID")
			}
			req.ForTask = n
		case "--cross-channel":
			req.CrossChannel = true
		case "--label":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--label requires a value")
			}
			i++
			lbl := strings.TrimSpace(args[i])
			if lbl == "" {
				return req, "", fmt.Errorf("--label requires a non-empty value")
			}
			req.VideoLabels = append(req.VideoLabels, lbl)
		case "--ask-user":
			req.AskUser = true
		case "--to":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--to requires a user ID")
			}
			i++
			req.DMTo = strings.TrimSpace(args[i])
		case "--data-dir":
			if i+1 >= len(args) {
				return req, "", fmt.Errorf("--data-dir requires a value")
			}
			i++
			dataDir = args[i]
		case "--help", "-h":
			return req, "", errSendUsage
		default:
			positional = append(positional, args[i])
		}
	}

	if useStdin {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return req, "", fmt.Errorf("reading stdin: %w", err)
		}
		req.Message = strings.TrimSpace(string(data))
	}
	if req.Project == "" {
		req.Project = strings.TrimSpace(os.Getenv("CC_PROJECT"))
	}
	if req.DMTo != "" && !req.DM {
		return req, "", fmt.Errorf("--to works only with --dm")
	}
	if req.Channel != "" && (req.DM || req.SessionKey != "") {
		return req, "", fmt.Errorf("--channel cannot be combined with --session or --dm")
	}
	if req.DM {
		if req.SessionKey != "" {
			return req, "", fmt.Errorf("--dm cannot be combined with --session")
		}
		req.FromSession = strings.TrimSpace(envSessionKey())
	} else if req.Channel != "" {
		// The name is looked up in the server of the caller's own conversation.
		req.FromSession = strings.TrimSpace(envSessionKey())
	} else if req.SessionKey == "" && req.ForTask > 0 {
		// --for without -s: the bridge posts to the task's owner chat (11-25 #2010).
		req.FromSession = strings.TrimSpace(envSessionKey())
	} else if req.SessionKey == "" {
		req.SessionKey = strings.TrimSpace(envSessionKey())
		req.SessionFromEnv = req.SessionKey != ""
		// The workspace task this process was started for; the bridge moves attachments to the
		// chat channel only while that task is in work.
		req.Handoff = strings.TrimSpace(os.Getenv("CC_HANDOFF"))
	}
	if req.Handoff == "" && !req.DM {
		// The workspace task this process was started for: the bridge holds its sends to that task's
		// owner chat whatever the target (sendTaskTargetProblem), not only the ones without -s.
		req.Handoff = strings.TrimSpace(os.Getenv("CC_HANDOFF"))
	}
	if req.FromSession == "" {
		// The caller's own conversation, so the bridge knows a send comes from a scheduled turn (#1857).
		req.FromSession = strings.TrimSpace(envSessionKey())
	}
	if req.Message == "" {
		req.Message = strings.Join(positional, " ")
	}

	if msg := foreignMediaProblem(dataDir, req.SessionKey, append(append(append(append([]string{}, imagePaths...), filePaths...), audioPaths...), videoPaths...)); msg != "" {
		return req, "", fmt.Errorf("%s", msg)
	}

	maxAtt := resolveMaxAttachmentSize(loadSendConfigBestEffort())

	images, err := loadImageAttachments(imagePaths, maxAtt)
	if err != nil {
		return req, "", err
	}
	files, err := loadFileAttachments(filePaths, maxAtt)
	if err != nil {
		return req, "", err
	}
	audioFiles, err := loadTypedFileAttachments(audioPaths, "audio", maxAtt)
	if err != nil {
		return req, "", err
	}
	videoFiles, err := loadTypedFileAttachments(videoPaths, "video", maxAtt)
	if err != nil {
		return req, "", err
	}
	req.Images = images
	// Keep audio / video clips on dedicated fields. Routing them through
	// req.Files would force the engine to dispatch them via FileSender —
	// that loses the native voice-bubble / video-bubble path on platforms
	// that implement AudioSender / VideoSender (e.g. Feishu's ffmpeg
	// transcode for mp3 → opus). See cc-connect internal task
	// t-20260615-cqjbk1.
	req.Files = files
	req.Audios = audioFiles
	req.Videos = videoFiles

	if req.Message == "" && req.TTSText == "" && len(req.Images) == 0 && len(req.Files) == 0 && len(req.Audios) == 0 && len(req.Videos) == 0 {
		return req, "", fmt.Errorf("message, tts text, or attachment is required")
	}

	if req.TaskText != nil && (req.TaskText.TaskID == "" || req.TaskText.DeliveryID == "" || req.TaskText.Revision < 1 || req.SessionKey == "") {
		return req, "", fmt.Errorf("task text requires --task, --revision, --delivery-id and --session")
	}
	return req, dataDir, nil
}

func loadImageAttachments(paths []string, maxSize int64) ([]core.ImageAttachment, error) {
	images := make([]core.ImageAttachment, 0, len(paths))
	for _, path := range paths {
		data, fileName, mimeType, err := readAttachment(path, maxSize)
		if err != nil {
			return nil, err
		}
		if !strings.HasPrefix(mimeType, "image/") {
			return nil, fmt.Errorf("%s is not an image (detected mime: %s)", path, mimeType)
		}
		images = append(images, core.ImageAttachment{MimeType: mimeType, Data: data, FileName: fileName})
	}
	return images, nil
}

func loadFileAttachments(paths []string, maxSize int64) ([]core.FileAttachment, error) {
	files := make([]core.FileAttachment, 0, len(paths))
	for _, path := range paths {
		data, fileName, mimeType, err := readAttachment(path, maxSize)
		if err != nil {
			return nil, err
		}
		files = append(files, core.FileAttachment{MimeType: mimeType, Data: data, FileName: fileName})
	}
	return files, nil
}

func loadTypedFileAttachments(paths []string, mediaType string, maxSize int64) ([]core.FileAttachment, error) {
	files := make([]core.FileAttachment, 0, len(paths))
	for _, path := range paths {
		data, fileName, mimeType, err := readAttachment(path, maxSize)
		if err != nil {
			return nil, err
		}
		if !attachmentMatchesMediaType(mimeType, fileName, mediaType) {
			return nil, fmt.Errorf("%s is not %s media (detected mime: %s)", path, mediaType, mimeType)
		}
		files = append(files, core.FileAttachment{MimeType: mimeType, Data: data, FileName: fileName})
	}
	return files, nil
}

func attachmentMatchesMediaType(mimeType, fileName, mediaType string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch mediaType {
	case "audio":
		if strings.HasPrefix(mimeType, "audio/") {
			return true
		}
		switch ext {
		case ".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav":
			return true
		}
	case "video":
		if strings.HasPrefix(mimeType, "video/") {
			return true
		}
		switch ext {
		case ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm":
			return true
		}
	}
	return false
}

// loadSendConfigBestEffort loads config.toml — resolved the same way the
// daemon resolves it — so the standalone `cc-connect send` subcommand (a
// separate process that otherwise has no config) can honour
// max_attachment_size_mb. Errors are ignored and nil is returned, so a missing
// or invalid config never breaks sending; the caller then falls back to the
// env var / default via resolveMaxAttachmentSize.
func loadSendConfigBestEffort() *config.Config {
	cfg, err := config.Load(resolveConfigPath(""))
	if err != nil {
		return nil
	}
	return cfg
}

// readAttachment reads a single attachment file, rejecting anything larger than
// maxSize bytes (resolved by the caller from config/env/default). The limit is
// enforced before the file is read into memory.
func readAttachment(path string, maxSize int64) ([]byte, string, string, error) {
	cleaned := filepath.Clean(path)

	info, err := os.Stat(cleaned)
	if err != nil {
		return nil, "", "", fmt.Errorf("read attachment %s: %w", path, err)
	}
	if info.Size() > maxSize {
		return nil, "", "", fmt.Errorf("attachment %s exceeds size limit (%d MB)", path, maxSize>>20)
	}

	data, err := os.ReadFile(cleaned)
	if err != nil {
		return nil, "", "", fmt.Errorf("read attachment %s: %w", path, err)
	}
	fileName := filepath.Base(cleaned)
	return data, fileName, detectAttachmentMimeType(fileName, data), nil
}

func detectAttachmentMimeType(fileName string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".md", ".markdown":
		return "text/markdown; charset=utf-8"
	}
	if byExt := mime.TypeByExtension(ext); byExt != "" {
		return byExt
	}
	if len(data) == 0 {
		return "application/octet-stream"
	}
	sniff := data
	if len(sniff) > 512 {
		sniff = sniff[:512]
	}
	return http.DetectContentType(sniff)
}

func buildSendPayload(req core.SendRequest) ([]byte, error) {
	return json.Marshal(req)
}

func resolveSocketPath(dataDir string) string {
	if dataDir != "" {
		return filepath.Join(dataDir, "run", "api.sock")
	}
	// Check CC_DATA_DIR env var for custom data_dir configuration
	if envDataDir := ccconnect.GuardTestDataDir(strings.TrimSpace(os.Getenv("CC_DATA_DIR"))); envDataDir != "" {
		return filepath.Join(envDataDir, "run", "api.sock")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(ccconnect.DataDir(home), "run", "api.sock")
	}
	return filepath.Join(".bothouse", "run", "api.sock")
}

func printSendUsage() {
	fmt.Println(`Usage: bothouse send [options] <message>
       bothouse send [options] -m <message>
       bothouse send [options] --stdin < file
       bothouse send [options] --image <path>
       bothouse send [options] --file <path>
       bothouse send [options] --audio <path>
       bothouse send [options] --video <path>
       bothouse send [options] --tts <text>
       echo "msg" | bothouse send [options] --stdin

Send a message, attachment, or synthesized voice message to an active bothouse session.

Options:
      --task <id>          Persist task-bound text (acceptance is not delivery)
      --revision <n>       Required current task revision
      --delivery-id <id>   Stable request ID; reuse only for the same text/target
      --text-kind <kind>   result (default), receipt, or question
  -m, --message <text>     Message to send (preferred over positional args)
      --cwd <path>         Start a new session in this working directory
      --work-dir <path>    Alias for --cwd
      --tts <text>         Synthesize text and send it as a voice/audio message
      --image <path>       Send an image attachment (repeatable)
      --file <path>        Send a file attachment (repeatable)
      --audio <path>       Send an audio attachment (repeatable)
      --video <path>       Send a video attachment (repeatable)
      --stdin              Read message from stdin (best for long/special-char messages)
      --at-users <ids>     @ user IDs, comma-separated (QQ, QQBot)
      --at-all             @ everyone (platform permissions and limits apply)
      --reply-to <id>      Native quoted text reply to a message in this conversation (QQ)
      --mention-assigner <id>  Open the message with an @ of whoever set task board item <id> (ws-pass; off unless the lead project sets mention_assigner)
      --board-id <id>      Task board ID used to prefix ASCII upload filenames for video attachments
      --for <id>           The task board item this message is for. Without -s/--channel the bridge posts it
                           to that task's own chat. With one, a target that is not the task's chat, its forum
                           thread or a workspace is refused. In a workspace, CC_HANDOFF names the task.
      --cross-channel      Send a task's message to another chat on purpose (skips the check above)
      --label <text>       Version label line sent right before each video attachment (repeatable)
      --ask-user           Ask a human to decide/answer: allows @ human mentions on this message (auto-mentions the owner if no <@id> is in the message)
      --experience         Hand work to a personal agent: append related team lessons and ask for 【经验】 lines back
      --dm                 Send privately; without --to only to the project owner (first ID in admin_from) (Discord, QQ)
      --to <user id>       With --dm: send privately to this member of the server instead (Discord)
      --channel <name>     Send to the channel with this name (Discord: in this server; Feishu: among
                           the groups the bot is in); not found or more than one with that name is an
                           error and nothing is sent
  -p, --project <name>     Target project (optional if only one project)
  -s, --session <key>      Target session key (optional, picks first active)
                           With --channel or -s the output says where it went: 已发到 #<name>（<id>）
      --data-dir <path>    Data directory (default: ~/.bothouse)
  -h, --help               Show this help

Examples:
  bothouse send "Daily summary: ..."
  bothouse send -m "Build completed successfully"
  bothouse send --message "Chart generated" --image /tmp/chart.png
  bothouse send --file /tmp/report.pdf
  bothouse send --video /tmp/demo.mp4
  bothouse send --audio /tmp/voice.opus
  bothouse send --tts "Hello from bothouse"
  bothouse send --dm "A word just for you"
  bothouse send --dm --to 123456789012345678 "Your device code is ..."
  bothouse send --stdin <<'EOF'
    Long message with "special" chars, $variables, and newlines
  EOF`)
}
