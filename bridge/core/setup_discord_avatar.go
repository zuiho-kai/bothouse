package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
)

// discordSetAvatar sets the bot user's picture: PATCH /users/@me, tried once (no retry on 429:
// Discord rate-limits avatar changes hard, and the role works without it).
func discordSetAvatar(ctx context.Context, token string, img []byte) error {
	body, _ := json.Marshal(map[string]string{"avatar": AvatarDataURI(img)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, discordAPIBase+"/users/@me", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bot "+strings.TrimPrefix(strings.TrimSpace(token), "Bot "))
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: setupHTTPTimeout}).Do(req)
	if err != nil {
		return fmt.Errorf("discord: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("discord: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

// applyDiscordAvatars sets each bot's picture when its library avatar differs from the one the
// state recorded. A failure only warns; the team entry keeps the old avatar so the next run tries again.
func applyDiscordAvatars(ctx context.Context, dataDir, lang string, roles []plannedRole, team []SetupTeamEntry, old []SetupTeamEntry, res *WizardResult) {
	prev := map[string]string{}
	for _, t := range old {
		prev[t.Project] = t.Avatar
	}
	tokens := map[string]string{}
	for _, r := range roles {
		tokens[r.project] = r.token
	}
	for i := range team {
		t := &team[i]
		tok := tokens[t.Project]
		if t.Avatar == "" || t.Avatar == prev[t.Project] || tok == "" {
			continue
		}
		img, _, ok := LibraryAvatarImage(dataDir, t.Avatar)
		err := fmt.Errorf("avatar %q not in the library", t.Avatar)
		if ok {
			err = discordSetAvatar(ctx, tok, img)
		}
		if err != nil {
			name := t.Name
			if name == "" {
				name = t.Project
			}
			res.Warnings = append(res.Warnings, warnAvatarNotSet(lang, name, err))
			t.Avatar = prev[t.Project]
		}
	}
}

func warnAvatarNotSet(lang, bot string, err error) WizardWarning {
	slog.Warn("setup: discord avatar not set", "bot", bot, "error", err)
	w := WizardWarning{Code: "discord_avatar_not_set", Project: bot, URL: DiscordPortalURL}
	if isJA(lang) {
		w.Message = "ボット「" + bot + "」のアイコンを設定できませんでした。あとで Discord Developer Portal で手動で変更できます。"
	} else if isZH(lang) {
		w.Message = "机器人「" + bot + "」头像没设上，可以稍后在 Discord 开发者后台手动换。"
	} else {
		w.Message = "Bot \"" + bot + "\": the avatar was not set. You can change it later by hand in the Discord Developer Portal."
	}
	return w
}
