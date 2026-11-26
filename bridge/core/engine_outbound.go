package core

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

// SendToSession sends a message to an active session from an external caller (API/CLI).
// If sessionKey is empty, it picks the first active session.
func (e *Engine) SendToSession(sessionKey, message string) error {
	return e.SendToSessionWithAttachments(sessionKey, message, nil, nil, nil, false)
}

// SendOptions controls optional behavior for external send callers.
type SendOptions struct {
	WorkDir            string
	AtUsers            []string
	AtAll              bool
	ReplyToMessageID   string
	AllowHumanMentions []string
	BoardID            int
	VideoLabels        []string
	// ReplyBoard: the board item the message is for; each posted message id is recorded with it
	// (team_reply_tasks.json), so a user's reply to it is known to be about that task (#2010).
	ReplyBoard int
}

func (e *Engine) SendToSessionWithAttachments(sessionKey, message string, images []ImageAttachment, files []FileAttachment, atUsers []string, atAll bool) error {
	return e.SendToSessionWithOptions(sessionKey, message, images, files, SendOptions{AtUsers: atUsers, AtAll: atAll})
}

func (e *Engine) SendToSessionWithOptions(sessionKey, message string, images []ImageAttachment, files []FileAttachment, opts SendOptions) error {
	if opts.ReplyToMessageID != "" && (sessionKey == "" || strings.TrimSpace(message) == "" || strings.TrimSpace(opts.WorkDir) != "") {
		return fmt.Errorf("native reply requires text and an explicit conversation without a work directory override")
	}
	if strings.TrimSpace(opts.WorkDir) != "" {
		workDir, useWorkDirSession, err := e.resolveSendWorkDir(opts.WorkDir)
		if err != nil {
			return err
		}
		if useWorkDirSession {
			return e.sendToSessionInWorkDir(sessionKey, message, images, files, workDir, opts.AtUsers, opts.AtAll, opts.AllowHumanMentions, opts.BoardID, opts.VideoLabels)
		}
	}

	target, err := e.resolveSendTarget(sessionKey, len(images) > 0 || len(files) > 0)
	if err != nil {
		return err
	}
	state, p, replyCtx := target.state, target.platform, target.replyCtx
	if p == nil {
		return fmt.Errorf("no active session found (key=%q)", sessionKey)
	}
	replyCtx = e.recordReplyTask(p, replyCtx, opts.ReplyBoard)

	if message == "" && len(images) == 0 && len(files) == 0 {
		return fmt.Errorf("message or attachment is required")
	}
	if (len(images) > 0 || len(files) > 0) && !e.attachmentSendEnabled {
		return ErrAttachmentSendDisabled
	}

	var imageSender ImageSender
	if len(images) > 0 {
		var ok bool
		imageSender, ok = p.(ImageSender)
		if !ok {
			return fmt.Errorf("platform %s: %w", p.Name(), ErrNotSupported)
		}
	}

	var replySender MessageReplySender
	if opts.ReplyToMessageID != "" {
		var ok bool
		replySender, ok = p.(MessageReplySender)
		if !ok {
			return fmt.Errorf("platform %s: native message replies: %w", p.Name(), ErrNotSupported)
		}
	}

	var fileSender FileSender
	if len(files) > 0 {
		var ok bool
		fileSender, ok = p.(FileSender)
		if !ok {
			return fmt.Errorf("platform %s: %w", p.Name(), ErrNotSupported)
		}
	}

	if message != "" {
		if err := e.waitOutgoing(p); err != nil {
			return err
		}
		sendCtx := e.ctx
		if len(opts.AllowHumanMentions) > 0 {
			sendCtx = WithAllowHumanMentions(sendCtx, opts.AllowHumanMentions...)
		}
		// Use AtMentionSender when @users specified and platform supports it
		if replySender != nil {
			if err := replySender.ReplyToMessage(sendCtx, replyCtx, message, opts.ReplyToMessageID, opts.AtUsers, opts.AtAll); err != nil {
				return err
			}
		} else if len(opts.AtUsers) > 0 || opts.AtAll {
			if atSender, ok := p.(AtMentionSender); ok {
				if err := atSender.ReplyWithAt(sendCtx, replyCtx, message, opts.AtUsers, opts.AtAll); err != nil {
					return err
				}
			} else {
				if err := p.Send(sendCtx, replyCtx, message); err != nil {
					return err
				}
			}
		} else {
			if err := p.Send(sendCtx, replyCtx, message); err != nil {
				return err
			}
		}
		if state != nil {
			state.mu.Lock()
			state.sideText = strings.TrimSpace(message)
			state.turnSentTexts = append(state.turnSentTexts, message)
			state.mu.Unlock()
		}
		contextKey := sessionKey
		if contextKey == "" {
			contextKey = target.sessionKey
		}
		workDir := ""
		if state != nil {
			state.mu.Lock()
			workDir = state.workspaceDir
			state.mu.Unlock()
		}
		e.recordExternalSend(p, contextKey, workDir, message, "脚本/API")
		// a workspace's own posts (ws-up stage results) also go into its task thread
		e.postToTaskThread(p, sessionKey, message)
	}
	for _, img := range images {
		if err := e.waitOutgoing(p); err != nil {
			return err
		}
		if err := imageSender.SendImage(e.ctx, replyCtx, img); err != nil {
			return err
		}
		if state != nil {
			// #181: an image does not enter turnSentTexts (that list holds text
			// only), so the turn remembers separately that something non-text
			// already went out.
			state.mu.Lock()
			state.turnSentNonText = true
			state.mu.Unlock()
		}
	}
	// a workspace's images go back to the chat channel with its [report]/[ask] (team_exit_images.go)
	e.noteWorkspaceImages(sessionKey, images)
	e.noteWorkspaceFiles(sessionKey, files)
	prepared := prepareFileSends(files, opts.BoardID, opts.VideoLabels)
	videoCount := 0
	for _, item := range prepared {
		if item.label != "" {
			videoCount++
		}
	}
	trimmedMsg := strings.TrimSpace(message)
	for _, item := range prepared {
		if item.label != "" && !(videoCount == 1 && trimmedMsg == item.label) {
			if err := e.waitOutgoing(p); err != nil {
				return err
			}
			if err := p.Send(e.ctx, replyCtx, item.label); err != nil {
				return err
			}
		}
		if err := e.waitOutgoing(p); err != nil {
			return err
		}
		if err := fileSender.SendFile(e.ctx, replyCtx, item.file); err != nil {
			return err
		}
		if state != nil {
			state.mu.Lock()
			state.turnSentNonText = true
			state.mu.Unlock()
		}
	}
	return nil
}

type sendTarget struct {
	state      *interactiveState
	platform   Platform
	replyCtx   any
	sessionKey string
}

func (e *Engine) SendToSessionInWorkDir(sessionKey, message string, images []ImageAttachment, files []FileAttachment, workDir string, atUsers []string, atAll bool) error {
	return e.sendToSessionInWorkDir(sessionKey, message, images, files, workDir, atUsers, atAll, nil, 0, nil)
}

func (e *Engine) sendToSessionInWorkDir(sessionKey, message string, images []ImageAttachment, files []FileAttachment, workDir string, atUsers []string, atAll bool, allowHumans []string, boardID int, videoLabels []string) error {
	if message == "" && len(images) == 0 && len(files) == 0 {
		return fmt.Errorf("message or attachment is required")
	}
	if (len(images) > 0 || len(files) > 0) && !e.attachmentSendEnabled {
		return ErrAttachmentSendDisabled
	}

	target, err := e.resolveSendTarget(sessionKey, len(images) > 0 || len(files) > 0)
	if err != nil {
		return err
	}
	if target.platform == nil {
		return fmt.Errorf("no active session found (key=%q)", sessionKey)
	}

	_, sessions, err := e.getOrCreateWorkspaceAgent(workDir)
	if err != nil {
		return err
	}
	session := sessions.NewSession(target.sessionKey, "send")
	sessions.Save()
	e.bindSendWorkDir(target.sessionKey, workDir)

	var imageSender ImageSender
	if len(images) > 0 {
		var ok bool
		imageSender, ok = target.platform.(ImageSender)
		if !ok {
			return fmt.Errorf("platform %s: %w", target.platform.Name(), ErrNotSupported)
		}
	}

	var fileSender FileSender
	if len(files) > 0 {
		var ok bool
		fileSender, ok = target.platform.(FileSender)
		if !ok {
			return fmt.Errorf("platform %s: %w", target.platform.Name(), ErrNotSupported)
		}
	}

	if message != "" {
		if err := e.waitOutgoing(target.platform); err != nil {
			return err
		}
		sendCtx := e.ctx
		if len(allowHumans) > 0 {
			sendCtx = WithAllowHumanMentions(sendCtx, allowHumans...)
		}
		if len(atUsers) > 0 || atAll {
			if atSender, ok := target.platform.(AtMentionSender); ok {
				if err := atSender.ReplyWithAt(sendCtx, target.replyCtx, message, atUsers, atAll); err != nil {
					return err
				}
			} else if err := target.platform.Send(sendCtx, target.replyCtx, message); err != nil {
				return err
			}
		} else {
			if err := target.platform.Send(sendCtx, target.replyCtx, message); err != nil {
				return err
			}
		}
		if target.state != nil {
			target.state.mu.Lock()
			target.state.sideText = strings.TrimSpace(message)
			target.state.turnSentTexts = append(target.state.turnSentTexts, message)
			target.state.mu.Unlock()
		}
		session.AddHistory("assistant", message)
		sessions.Save()
		e.recordExternalSend(target.platform, target.sessionKey, workDir, message, "脚本/API")
	}
	for _, img := range images {
		if err := e.waitOutgoing(target.platform); err != nil {
			return err
		}
		if err := imageSender.SendImage(e.ctx, target.replyCtx, img); err != nil {
			return err
		}
		if target.state != nil {
			// #181: image sends are not text, so they are remembered separately.
			target.state.mu.Lock()
			target.state.turnSentNonText = true
			target.state.mu.Unlock()
		}
	}
	e.noteWorkspaceImages(target.sessionKey, images)
	e.noteWorkspaceFiles(target.sessionKey, files)
	prepared := prepareFileSends(files, boardID, videoLabels)
	videoCount := 0
	for _, item := range prepared {
		if item.label != "" {
			videoCount++
		}
	}
	trimmedMsg := strings.TrimSpace(message)
	for _, item := range prepared {
		if item.label != "" && !(videoCount == 1 && trimmedMsg == item.label) {
			if err := e.waitOutgoing(target.platform); err != nil {
				return err
			}
			if err := target.platform.Send(e.ctx, target.replyCtx, item.label); err != nil {
				return err
			}
		}
		if err := e.waitOutgoing(target.platform); err != nil {
			return err
		}
		if err := fileSender.SendFile(e.ctx, target.replyCtx, item.file); err != nil {
			return err
		}
		if target.state != nil {
			target.state.mu.Lock()
			target.state.turnSentNonText = true
			target.state.mu.Unlock()
		}
	}
	return nil
}

func (e *Engine) resolveSendTarget(sessionKey string, attachments bool) (sendTarget, error) {
	e.interactiveMu.Lock()

	resolvedSessionKey := sessionKey
	var state *interactiveState
	if sessionKey != "" {
		state = e.interactiveStates[sessionKey]
		if state == nil && e.multiWorkspace {
			if iKey := e.interactiveKeyForSessionKeyLocked(sessionKey); iKey != sessionKey {
				state = e.interactiveStates[iKey]
			}
		}
	} else if len(e.interactiveStates) == 1 {
		for key, s := range e.interactiveStates {
			resolvedSessionKey = key
			state = s
			break
		}
	} else if len(e.interactiveStates) > 1 && attachments {
		e.interactiveMu.Unlock()
		return sendTarget{}, fmt.Errorf("multiple active sessions; must specify --session to send attachments")
	} else {
		for key, s := range e.interactiveStates {
			resolvedSessionKey = key
			state = s
			break
		}
	}
	e.interactiveMu.Unlock()

	var p Platform
	var replyCtx any
	if state != nil {
		state.mu.Lock()
		if state.localInputOnly != nil {
			state.mu.Unlock()
			return sendTarget{}, fmt.Errorf("local input output is restricted to its response endpoint")
		}
		p = unmutedPlatform(state.platform)
		replyCtx = state.replyCtx
		state.mu.Unlock()
	}

	if p == nil && resolvedSessionKey != "" {
		strippedKey := resolvedSessionKey
		platformName := ""
		if idx := strings.Index(strippedKey, ":"); idx > 0 {
			platformName = strippedKey[:idx]
		}
		var targetPlatform Platform
		for _, candidate := range e.platforms {
			if candidate.Name() == platformName {
				targetPlatform = candidate
				break
			}
		}
		if targetPlatform == nil {
			for _, candidate := range e.platforms {
				needle := ":" + candidate.Name() + ":"
				if idx := strings.Index(strippedKey, needle); idx >= 0 {
					targetPlatform = candidate
					strippedKey = strippedKey[idx+1:]
					break
				}
			}
		}
		if targetPlatform != nil {
			rc, ok := targetPlatform.(ReplyContextReconstructor)
			if !ok {
				return sendTarget{}, fmt.Errorf("platform %q does not support proactive messaging", targetPlatform.Name())
			}
			reconstructed, err := rc.ReconstructReplyCtx(strippedKey)
			if err != nil {
				return sendTarget{}, fmt.Errorf("reconstruct reply context: %w", err)
			}
			p = targetPlatform
			replyCtx = reconstructed
			resolvedSessionKey = strippedKey
		}
	}

	return sendTarget{
		state:      state,
		platform:   p,
		replyCtx:   replyCtx,
		sessionKey: resolvedSessionKey,
	}, nil
}

func (e *Engine) resolveSendWorkDir(workDir string) (string, bool, error) {
	current := e.currentSendWorkDir()
	target, err := normalizeSendWorkDir(workDir, current)
	if err != nil {
		return "", false, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", false, fmt.Errorf("work_dir %q: %w", target, err)
	}
	if !info.IsDir() {
		return "", false, fmt.Errorf("work_dir %q is not a directory", target)
	}

	if current != "" {
		if normalizedCurrent, err := normalizeSendWorkDir(current, ""); err == nil && normalizedCurrent == target {
			return target, false, nil
		}
	}
	return target, true, nil
}

func (e *Engine) currentSendWorkDir() string {
	if e.agent != nil {
		if wd, ok := e.agent.(interface{ GetWorkDir() string }); ok {
			if dir := strings.TrimSpace(wd.GetWorkDir()); dir != "" {
				return dir
			}
		}
	}
	if strings.TrimSpace(e.baseWorkDir) != "" {
		return strings.TrimSpace(e.baseWorkDir)
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return ""
}

func normalizeSendWorkDir(workDir, base string) (string, error) {
	dir := strings.TrimSpace(workDir)
	if dir == "" {
		return "", fmt.Errorf("work_dir is required")
	}
	if dir == "~" || strings.HasPrefix(dir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		if dir == "~" {
			dir = home
		} else {
			dir = filepath.Join(home, strings.TrimPrefix(dir, "~/"))
		}
	}
	if !filepath.IsAbs(dir) {
		if strings.TrimSpace(base) == "" {
			var err error
			base, err = os.Getwd()
			if err != nil {
				return "", fmt.Errorf("resolve current directory: %w", err)
			}
		}
		dir = filepath.Join(base, dir)
	}
	abs, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return "", err
	}
	return abs, nil
}

// SendTTSToSession synthesizes and sends a voice message to an active session.
// It is used by the local API/CLI so agents can call `cc-connect send --tts`.
func (e *Engine) SendTTSToSession(sessionKey, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return fmt.Errorf("tts text is required")
	}
	_, p, replyCtx, err := e.resolveOutboundSessionTarget(sessionKey, false)
	if err != nil {
		return err
	}
	return e.synthesizeAndSendTTS(p, replyCtx, text)
}

// SendAudiosToSession routes outbound audio attachments to the
// platform's AudioSender (native voice bubble + transcoding) when
// supported, falling back to FileSender otherwise. Used by
// `cc-connect send --audio`. Mirrors SendToSessionWithAttachments for
// audio-typed clips so they don't get dispatched as generic files.
func (e *Engine) SendAudiosToSession(sessionKey string, audios []FileAttachment) error {
	if len(audios) == 0 {
		return nil
	}
	_, p, replyCtx, err := e.resolveOutboundSessionTarget(sessionKey, true)
	if err != nil {
		return err
	}
	if !e.attachmentSendEnabled {
		return ErrAttachmentSendDisabled
	}

	audioSender, audioOK := p.(AudioSender)
	fileSender, fileOK := p.(FileSender)
	if !audioOK && !fileOK {
		return fmt.Errorf("platform %s: %w", p.Name(), ErrNotSupported)
	}

	for _, a := range audios {
		if err := e.waitOutgoing(p); err != nil {
			return err
		}
		format := audioFormatHint(a)
		if audioOK {
			if err := audioSender.SendAudio(e.ctx, replyCtx, a.Data, format); err != nil {
				return err
			}
			continue
		}
		// Fallback: platform has no AudioSender. Send as a plain file so
		// the user still receives the clip — but warn so operators know
		// the native voice bubble was unavailable.
		slog.Warn("send: platform has no AudioSender, falling back to SendFile",
			"platform", p.Name(), "file_name", a.FileName, "format", format)
		if err := fileSender.SendFile(e.ctx, replyCtx, a); err != nil {
			return err
		}
	}
	return nil
}

// SendVideosToSession routes outbound video attachments to the
// platform's VideoSender (native video bubble) when supported, falling
// back to FileSender otherwise. Used by `cc-connect send --video`.
func (e *Engine) SendVideosToSession(sessionKey string, videos []FileAttachment) error {
	return e.SendVideosToSessionWithOptions(sessionKey, videos, SendOptions{})
}

func (e *Engine) SendVideosToSessionWithOptions(sessionKey string, videos []FileAttachment, opts SendOptions) error {
	if len(videos) == 0 {
		return nil
	}
	_, p, replyCtx, err := e.resolveOutboundSessionTarget(sessionKey, true)
	if err != nil {
		return err
	}
	if !e.attachmentSendEnabled {
		return ErrAttachmentSendDisabled
	}
	replyCtx = e.recordReplyTask(p, replyCtx, opts.ReplyBoard)

	videoSender, videoOK := p.(VideoSender)
	fileSender, fileOK := p.(FileSender)
	if !videoOK && !fileOK {
		return fmt.Errorf("platform %s: %w", p.Name(), ErrNotSupported)
	}

	for _, item := range prepareFileSends(videos, opts.BoardID, opts.VideoLabels) {
		if item.label != "" {
			if err := e.waitOutgoing(p); err != nil {
				return err
			}
			if err := p.Send(e.ctx, replyCtx, item.label); err != nil {
				return err
			}
		}
		if err := e.waitOutgoing(p); err != nil {
			return err
		}
		format := videoFormatHint(item.file)
		if videoOK {
			if err := videoSender.SendVideo(e.ctx, replyCtx, item.file.Data, format, item.file.FileName); err != nil {
				return err
			}
			continue
		}
		slog.Warn("send: platform has no VideoSender, falling back to SendFile",
			"platform", p.Name(), "file_name", item.file.FileName, "format", format)
		if err := fileSender.SendFile(e.ctx, replyCtx, item.file); err != nil {
			return err
		}
	}
	return nil
}

// audioFormatHint extracts the short format hint (e.g. "mp3", "opus")
// from a FileAttachment. Filename extension wins over MIME type because
// the CLI-uploaded name is more reliable than detected MIME (raw
// audio bytes often sniff to application/octet-stream).
func audioFormatHint(a FileAttachment) string {
	if ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(a.FileName), ".")); ext != "" {
		return ext
	}
	if a.MimeType != "" {
		// "audio/mpeg" -> "mpeg"; "audio/ogg; codecs=opus" -> "ogg"
		mt := strings.ToLower(a.MimeType)
		if i := strings.Index(mt, ";"); i >= 0 {
			mt = mt[:i]
		}
		if i := strings.Index(mt, "/"); i >= 0 {
			return strings.TrimSpace(mt[i+1:])
		}
	}
	return ""
}

// videoFormatHint mirrors audioFormatHint for video clips.
func videoFormatHint(v FileAttachment) string {
	return audioFormatHint(v)
}

func (e *Engine) resolveOutboundSessionTarget(sessionKey string, hasAttachments bool) (*interactiveState, Platform, any, error) {
	e.interactiveMu.Lock()

	var state *interactiveState
	if sessionKey != "" {
		state = e.interactiveStates[sessionKey]
		if state == nil && e.multiWorkspace {
			// We already hold interactiveMu, so call the *Locked variant
			// to avoid a self-deadlock on the non-reentrant mutex.
			if iKey := e.interactiveKeyForSessionKeyLocked(sessionKey); iKey != sessionKey {
				state = e.interactiveStates[iKey]
			}
		}
	} else if len(e.interactiveStates) == 1 {
		// Single session: use it when no sessionKey is provided (backward compatible)
		for _, s := range e.interactiveStates {
			state = s
			break
		}
	} else if len(e.interactiveStates) > 1 && hasAttachments {
		// Multiple sessions with attachments but no explicit sessionKey: ambiguous
		e.interactiveMu.Unlock()
		return nil, nil, nil, fmt.Errorf("multiple active sessions; must specify --session to send attachments")
	} else {
		// Multiple sessions but text-only: pick the first (legacy behavior)
		for _, s := range e.interactiveStates {
			state = s
			break
		}
	}
	e.interactiveMu.Unlock()

	var p Platform
	var replyCtx any
	if state != nil {
		state.mu.Lock()
		if state.localInputOnly != nil {
			state.mu.Unlock()
			return nil, nil, nil, fmt.Errorf("local input output is restricted to its response endpoint")
		}
		p = unmutedPlatform(state.platform)
		replyCtx = state.replyCtx
		state.mu.Unlock()
	}

	if p == nil && sessionKey != "" {
		strippedKey := sessionKey
		platformName := ""
		if idx := strings.Index(strippedKey, ":"); idx > 0 {
			platformName = strippedKey[:idx]
		}
		var targetPlatform Platform
		for _, candidate := range e.platforms {
			if candidate.Name() == platformName {
				targetPlatform = candidate
				break
			}
		}
		// Fallback: multi-workspace mode may prefix the session key with the
		// workspace path (same heuristic as ExecuteCronJob / ExecuteHeartbeat).
		if targetPlatform == nil {
			for _, candidate := range e.platforms {
				needle := ":" + candidate.Name() + ":"
				if idx := strings.Index(strippedKey, needle); idx >= 0 {
					targetPlatform = candidate
					strippedKey = strippedKey[idx+1:]
					break
				}
			}
		}
		if targetPlatform != nil {
			rc, ok := targetPlatform.(ReplyContextReconstructor)
			if !ok {
				return nil, nil, nil, fmt.Errorf("platform %q does not support proactive messaging", targetPlatform.Name())
			}
			reconstructed, err := rc.ReconstructReplyCtx(strippedKey)
			if err != nil {
				return nil, nil, nil, fmt.Errorf("reconstruct reply context: %w", err)
			}
			p = targetPlatform
			replyCtx = reconstructed
		}
	}

	if p == nil {
		return nil, nil, nil, fmt.Errorf("no active session found (key=%q)", sessionKey)
	}
	return state, p, replyCtx, nil
}

// sendPermissionPrompt sends a permission prompt with interactive buttons when
// the platform supports them. Fallback chain: InlineButtonSender → CardSender → plain text.
func (e *Engine) sendPermissionPrompt(p Platform, replyCtx any, prompt, toolName, toolInput string) {
	e.emitEvent(HookEvent{
		Event:    HookEventPermissionRequested,
		Platform: p.Name(),
		Content:  prompt,
		Extra:    map[string]any{"tool_name": toolName},
	})

	// Try inline buttons first (Telegram)
	if bs, ok := p.(InlineButtonSender); ok {
		buttons := [][]ButtonOption{
			{
				{Text: e.i18n.T(MsgPermBtnAllow), Data: "perm:allow"},
				{Text: e.i18n.T(MsgPermBtnDeny), Data: "perm:deny"},
			},
			{
				{Text: e.i18n.T(MsgPermBtnAllowAll), Data: "perm:allow_all"},
			},
		}
		if err := e.waitOutgoing(p); err != nil {
			slog.Warn("sendPermissionPrompt: outgoing wait cancelled", "platform", p.Name(), "error", err)
			return
		}
		if err := bs.SendWithButtons(e.ctx, replyCtx, prompt, buttons); err == nil {
			return
		} else {
			slog.Warn("sendPermissionPrompt: inline buttons failed, falling back", "error", err)
		}
	}

	// Try card with buttons (Feishu/Lark)
	if supportsCards(p) {
		body := fmt.Sprintf(e.i18n.T(MsgPermCardBody), toolName, toolInput)
		extra := func(label, color string) map[string]string {
			return map[string]string{
				"perm_label": label,
				"perm_color": color,
				"perm_body":  body,
			}
		}
		allowBtn := CardButton{Text: e.i18n.T(MsgPermBtnAllow), Type: "primary", Value: "perm:allow",
			Extra: extra("✅ "+e.i18n.T(MsgPermBtnAllow), "green")}
		denyBtn := CardButton{Text: e.i18n.T(MsgPermBtnDeny), Type: "danger", Value: "perm:deny",
			Extra: extra("❌ "+e.i18n.T(MsgPermBtnDeny), "red")}
		allowAllBtn := CardButton{Text: e.i18n.T(MsgPermBtnAllowAll), Type: "default", Value: "perm:allow_all",
			Extra: extra("✅ "+e.i18n.T(MsgPermBtnAllowAll), "green")}

		card := NewCard().
			Title(e.i18n.T(MsgPermCardTitle), "orange").
			Markdown(body).
			ButtonsEqual(allowBtn, denyBtn).
			Buttons(allowAllBtn).
			Note(e.i18n.T(MsgPermCardNote)).
			Build()
		e.sendWithCard(p, replyCtx, card)
		return
	}

	e.send(p, replyCtx, prompt)
}

// sendAskQuestionPrompt renders one question (by index) from the AskUserQuestion list.
// qIdx is the 0-based index of the question to display.
func (e *Engine) sendAskQuestionPrompt(p Platform, replyCtx any, questions []UserQuestion, qIdx int) {
	if qIdx >= len(questions) {
		return
	}
	q := questions[qIdx]
	total := len(questions)

	titleSuffix := ""
	if total > 1 {
		titleSuffix = fmt.Sprintf(" (%d/%d)", qIdx+1, total)
	}

	// Try card (Feishu/Lark)
	if supportsCards(p) {
		cb := NewCard().Title(e.i18n.T(MsgAskQuestionTitle)+titleSuffix, "blue")
		body := "**" + q.Question + "**"
		if q.MultiSelect {
			// For multiSelect, buttons would resolve on the first click and prevent
			// selecting multiple options. Render options as a numbered text list
			// instead, and instruct the user to reply with comma-separated numbers.
			body += e.i18n.T(MsgAskQuestionMulti) + "\n\n"
			for i, opt := range q.Options {
				body += fmt.Sprintf("%d. **%s**", i+1, opt.Label)
				if opt.Description != "" {
					body += " — " + opt.Description
				}
				body += "\n"
			}
			cb.Markdown(body)
			cb.Note(e.i18n.T(MsgAskQuestionNoteMulti))
		} else {
			cb.Markdown(body)
			for i, opt := range q.Options {
				desc := opt.Label
				if opt.Description != "" {
					desc += " — " + opt.Description
				}
				answerData := fmt.Sprintf("askq:%d:%d", qIdx, i+1)
				cb.ListItemBtnExtra(desc, opt.Label, "default", answerData, map[string]string{
					"askq_label":    opt.Label,
					"askq_question": q.Question,
				})
			}
			cb.Note(e.i18n.T(MsgAskQuestionNote))
		}
		e.sendWithCard(p, replyCtx, cb.Build())
		return
	}

	// Try inline buttons (Telegram)
	if bs, ok := p.(InlineButtonSender); ok {
		var textBuf strings.Builder
		textBuf.WriteString("❓ *")
		textBuf.WriteString(q.Question)
		textBuf.WriteString("*")
		textBuf.WriteString(titleSuffix)
		if q.MultiSelect {
			textBuf.WriteString(e.i18n.T(MsgAskQuestionMulti))
		}
		hasDesc := false
		for _, opt := range q.Options {
			if opt.Description != "" {
				hasDesc = true
				break
			}
		}
		if hasDesc {
			textBuf.WriteString("\n")
			for i, opt := range q.Options {
				textBuf.WriteString(fmt.Sprintf("\n*%d. %s*", i+1, opt.Label))
				if opt.Description != "" {
					textBuf.WriteString(" — ")
					textBuf.WriteString(opt.Description)
				}
			}
			textBuf.WriteString("\n")
		}
		var rows [][]ButtonOption
		for i, opt := range q.Options {
			rows = append(rows, []ButtonOption{{Text: opt.Label, Data: fmt.Sprintf("askq:%d:%d", qIdx, i+1)}})
		}
		if err := e.waitOutgoing(p); err != nil {
			slog.Warn("sendAskQuestionPrompt: outgoing wait cancelled", "platform", p.Name(), "error", err)
			return
		}
		if err := bs.SendWithButtons(e.ctx, replyCtx, textBuf.String(), rows); err == nil {
			return
		}
	}

	// Plain text fallback
	var sb strings.Builder
	sb.WriteString("❓ **")
	sb.WriteString(q.Question)
	sb.WriteString("**")
	sb.WriteString(titleSuffix)
	if q.MultiSelect {
		sb.WriteString(e.i18n.T(MsgAskQuestionMulti))
	}
	sb.WriteString("\n\n")
	for i, opt := range q.Options {
		sb.WriteString(fmt.Sprintf("%d. **%s**", i+1, opt.Label))
		if opt.Description != "" {
			sb.WriteString(" — ")
			sb.WriteString(opt.Description)
		}
		sb.WriteString("\n")
	}
	sb.WriteString(fmt.Sprintf("\n%s", e.i18n.T(MsgAskQuestionNote)))
	e.send(p, replyCtx, sb.String())
}

// waitOutgoing blocks on the per-platform outgoing rate limiter when enabled.
func (e *Engine) waitOutgoing(p Platform) error {
	orl := e.outgoingRL.Load()
	if orl == nil {
		return nil
	}
	return orl.Wait(e.ctx, p.Name())
}

func (e *Engine) renderOutgoingContentForWorkspace(p Platform, content, workspaceDir string) string {
	if strings.TrimSpace(content) == "" {
		return content
	}
	return TransformLocalReferences(content, e.references, e.agent.Name(), p.Name(), workspaceDir)
}

func (e *Engine) sendWithContextForWorkspace(ctx context.Context, p Platform, replyCtx any, content, workspaceDir string) error {
	if orl := e.outgoingRL.Load(); orl != nil {
		if err := orl.Wait(ctx, p.Name()); err != nil {
			return err
		}
	}
	content = e.renderOutgoingContentForWorkspace(p, content, workspaceDir)
	return e.sendRenderedWithContext(ctx, p, replyCtx, content)
}

func (e *Engine) renderCardForPlatform(p Platform, card *Card) *Card {
	return e.renderCardForPlatformWorkspace(p, card, "")
}

func (e *Engine) renderCardForPlatformWorkspace(p Platform, card *Card, workspaceDir string) *Card {
	if card == nil {
		return nil
	}
	out := &Card{}
	if card.Header != nil {
		h := *card.Header
		out.Header = &h
	}
	out.Elements = make([]CardElement, 0, len(card.Elements))
	for _, elem := range card.Elements {
		switch v := elem.(type) {
		case CardMarkdown:
			content := v.Content
			if workspaceDir != "" {
				content = e.renderOutgoingContentForWorkspace(p, v.Content, workspaceDir)
			}
			out.Elements = append(out.Elements, CardMarkdown{Content: content})
		case CardNote:
			text := v.Text
			if workspaceDir != "" {
				text = e.renderOutgoingContentForWorkspace(p, v.Text, workspaceDir)
			}
			out.Elements = append(out.Elements, CardNote{Text: text, Tag: v.Tag})
		case CardListItem:
			text := v.Text
			if workspaceDir != "" {
				text = e.renderOutgoingContentForWorkspace(p, v.Text, workspaceDir)
			}
			out.Elements = append(out.Elements, CardListItem{
				Text:     text,
				BtnText:  v.BtnText,
				BtnType:  v.BtnType,
				BtnValue: v.BtnValue,
				Extra:    v.Extra,
			})
		default:
			out.Elements = append(out.Elements, elem)
		}
	}
	return out
}

// sendWithError applies outgoing rate limiting and p.Send. It logs wait
// cancellation and platform failures, and returns a non-nil error on either.
func (e *Engine) sendWithError(p Platform, replyCtx any, content string) error {
	return e.sendWithErrorContext(e.ctx, p, replyCtx, content)
}

func (e *Engine) sendWithErrorContext(ctx context.Context, p Platform, replyCtx any, content string) error {
	if err := e.waitOutgoing(p); err != nil {
		slog.Warn("outgoing rate limit: context cancelled", "platform", p.Name(), "error", err)
		return err
	}
	return e.sendRenderedWithContext(ctx, p, replyCtx, content)
}

func (e *Engine) sendAlreadyRenderedWithError(p Platform, replyCtx any, content string) error {
	return e.sendRenderedWithContext(e.ctx, p, replyCtx, content)
}

func (e *Engine) sendRenderedWithContext(ctx context.Context, p Platform, replyCtx any, content string) error {
	// Hidden thinking/tool boundaries can flush a whitespace-only text delta.
	// It has no standalone message to deliver; media uses separate send paths.
	// This is the common rendered-text boundary (sendWithError* and sendRaw both
	// reach it), so the guard stays alongside develop's authorizedOutput/cancel
	// semantics instead of replacing the thin sendAlreadyRenderedWithError shim.
	if strings.TrimSpace(content) == "" {
		return nil
	}
	start := time.Now()
	if err := authorizedOutput(ctx, func() error { return p.Send(ctx, replyCtx, content) }); err != nil {
		// Check for context_token missing error (common for Weixin platform)
		if strings.Contains(err.Error(), "missing context_token") {
			slog.Error("platform send failed: context_token missing",
				"platform", p.Name(),
				"error", err,
				"content_len", len(content),
				"hint", "user needs to send a message to the bot first so a context_token can be captured")
		} else {
			slog.Error("platform send failed", "platform", p.Name(), "error", err, "content_len", len(content))
		}
		return err
	}
	if elapsed := time.Since(start); elapsed >= slowPlatformSend {
		slog.Warn("slow platform send", "platform", p.Name(), "elapsed", elapsed, "content_len", len(content))
	}
	return nil
}

// send wraps p.Send with error logging, slow-operation warnings, and outgoing rate limiting.
// turnPreviewCfg: a quiet (scheduled) turn shows no live preview; its text would
// otherwise appear in the chat while it is written and stay at each tool boundary.
func (e *Engine) turnPreviewCfg(quiet bool) StreamPreviewCfg {
	cfg := e.streamPreview
	if quiet {
		cfg.Enabled = false
	}
	return cfg
}

func (e *Engine) send(p Platform, replyCtx any, content string) {
	_ = e.sendWithError(p, replyCtx, content)
}

// sendRaw sends content without local-reference rendering. This is used for raw
// tool outputs, where preserving the original text is preferable to applying the
// agent-facing reference display transform.
func (e *Engine) sendRaw(p Platform, replyCtx any, content string) {
	if err := e.waitOutgoing(p); err != nil {
		slog.Warn("outgoing rate limit: context cancelled", "platform", p.Name(), "error", err)
		return
	}
	_ = e.sendAlreadyRenderedWithError(p, replyCtx, content)
}

// drainEvents discards any buffered events from the channel.
// Called before a new turn to prevent stale events from a previous turn's
// agent process from being mistaken for the new turn's response.
func drainEvents(ch <-chan Event) {
	drained := 0
	for {
		select {
		case _, ok := <-ch:
			if !ok {
				// Channel is closed; stop immediately to avoid an infinite loop.
				return
			}
			drained++
		default:
			if drained > 0 {
				slog.Warn("drained stale events from previous turn", "count", drained)
			}
			return
		}
	}
}

// replyWithError applies outgoing rate limiting and p.Reply.
func (e *Engine) replyWithError(p Platform, replyCtx any, content string) error {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	if err := e.waitOutgoing(p); err != nil {
		slog.Warn("outgoing rate limit: context cancelled", "platform", p.Name(), "error", err)
		return err
	}
	start := time.Now()
	if err := p.Reply(e.ctx, replyCtx, content); err != nil {
		slog.Error("platform reply failed", "platform", p.Name(), "error", err, "content_len", len(content))
		return err
	}
	if elapsed := time.Since(start); elapsed >= slowPlatformSend {
		slog.Warn("slow platform reply", "platform", p.Name(), "elapsed", elapsed, "content_len", len(content))
	}
	return nil
}

// reply wraps p.Reply with error logging, slow-operation warnings, and outgoing rate limiting.
func (e *Engine) reply(p Platform, replyCtx any, content string) {
	_ = e.replyWithError(p, replyCtx, content)
}

// replyWithButtons sends a reply with inline buttons if the platform supports it,
// otherwise falls back to plain text reply.
func (e *Engine) replyWithButtons(p Platform, replyCtx any, content string, buttons [][]ButtonOption) {
	if err := e.waitOutgoing(p); err != nil {
		slog.Warn("outgoing rate limit: context cancelled", "platform", p.Name(), "error", err)
		return
	}
	if bs, ok := p.(InlineButtonSender); ok {
		if err := bs.SendWithButtons(e.ctx, replyCtx, content, buttons); err == nil {
			return
		}
	}
	e.reply(p, replyCtx, content)
}

func supportsCards(p Platform) bool {
	_, ok := p.(CardSender)
	return ok
}

// replyWithCard sends a structured card via CardSender.
// For platforms without card support, renders as plain text (no intermediate fallback).
func (e *Engine) replyWithCard(p Platform, replyCtx any, card *Card) {
	if card == nil {
		slog.Error("replyWithCard: nil card", "platform", p.Name())
		return
	}
	if err := e.waitOutgoing(p); err != nil {
		slog.Warn("outgoing rate limit: context cancelled", "platform", p.Name(), "error", err)
		return
	}
	if cs, ok := p.(CardSender); ok {
		rendered := e.renderCardForPlatform(p, card)
		if err := cs.ReplyCard(e.ctx, replyCtx, rendered); err != nil {
			slog.Error("card reply failed", "platform", p.Name(), "error", err)
		}
		return
	}
	e.reply(p, replyCtx, e.renderCardForPlatform(p, card).RenderText())
}

// sendWithCard sends a card as a new message (not a reply).
func (e *Engine) sendWithCard(p Platform, replyCtx any, card *Card) {
	if card == nil {
		slog.Error("sendWithCard: nil card", "platform", p.Name())
		return
	}
	if err := e.waitOutgoing(p); err != nil {
		slog.Warn("outgoing rate limit: context cancelled", "platform", p.Name(), "error", err)
		return
	}
	if cs, ok := p.(CardSender); ok {
		rendered := e.renderCardForPlatform(p, card)
		if err := cs.SendCard(e.ctx, replyCtx, rendered); err != nil {
			slog.Error("card send failed", "platform", p.Name(), "error", err)
		}
		return
	}
	e.send(p, replyCtx, e.renderCardForPlatform(p, card).RenderText())
}
