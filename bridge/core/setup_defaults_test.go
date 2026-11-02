package core

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestWithDiary(t *testing.T) {
	for lang, want := range map[string]string{"zh": "## 日记", "ja": "## 日記", "en": "## Diary", "ko": "## Diary"} {
		p := WithDiary("# 角色\n你是橘。\n", lang)
		if !strings.Contains(p, want) || !strings.Contains(p, "diary.md") || !strings.Contains(p, "tail -n 40 diary.md") ||
			strings.Count(p, diaryMarker) != 1 || !strings.HasPrefix(p, "# 角色\n你是橘。\n\n"+diaryMarker) {
			t.Errorf("%s: %q", lang, p)
		}
		if WithDiary(p, lang) != p {
			t.Errorf("%s: not idempotent", lang)
		}
		for _, bad := range []string{"后宅", "~/", "<@"} {
			if strings.Contains(p, bad) {
				t.Errorf("%s: private content %q", lang, bad)
			}
		}
	}
	if p := WithDiary("a\r\nb\r\n", "en"); strings.Contains(strings.ReplaceAll(p, "\r\n", ""), "\n") {
		t.Errorf("CRLF persona got LF lines: %q", p)
	}
}

func TestApplyWizardNewRoleHasDiary(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Dsh"})
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	req := WizardRequest{Platform: "discord", Language: "zh", Discord: &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900"}, Roles: []WizardRole{
		{Token: t1, AgentType: "claudecode", Persona: "# 角色：橘\n"},
		{Token: t2, AgentType: "acp", ReplyLanguage: "en"}, // a DSH role runs over ACP
	}}
	res := ApplyWizard(context.Background(), env, req)
	if !res.OK {
		t.Fatalf("apply: %+v", res)
	}
	b, _ := os.ReadFile(res.Roles[0].PersonaFile)
	if !strings.Contains(string(b), "## 日记") || strings.Index(string(b), diaryMarker) > strings.Index(string(b), replyLanguageMarker) {
		t.Errorf("claude persona: %q", b)
	}
	b, _ = os.ReadFile(res.Roles[1].PersonaFile)
	if !strings.Contains(string(b), "## Diary") {
		t.Errorf("dsh persona: %q", b)
	}
	// a rerun on the same bots leaves their personas alone: still one diary section
	req.Roles = []WizardRole{{ReuseProject: res.Roles[0].Project}}
	if r := ApplyWizard(context.Background(), env, req); !r.OK {
		t.Fatalf("rerun: %+v", r)
	}
	b, _ = os.ReadFile(res.Roles[0].PersonaFile)
	if strings.Count(string(b), diaryMarker) != 1 {
		t.Errorf("rerun: %q", b)
	}
}

func TestAddMoodCronJobs(t *testing.T) {
	c := &memCron{}
	roles := []moodRole{{"a", "zh"}, {"b", "en"}, {"c", "ja"}}
	added, err := AddMoodCronJobs(c, roles, "discord:1")
	if err != nil || len(added) != 3 {
		t.Fatalf("added %v err %v", added, err)
	}
	want := []string{"0 9-23 * * *", "20 9-23 * * *", "40 9-23 * * *"}
	for i, j := range c.jobs {
		if j.CronExpr != want[i] || j.SessionKey != "discord:1" || j.Mute || !strings.Contains(j.Prompt, "NO_REPLY") {
			t.Fatalf("job %d: %+v", i, j)
		}
	}
	if added, _ := AddMoodCronJobs(c, roles, "discord:1"); len(added) != 0 || len(c.jobs) != 3 {
		t.Fatalf("second run added %v, jobs %d", added, len(c.jobs))
	}
	if !strings.Contains(diarySection("zh"), "心情") || !strings.Contains(diarySection("en"), "NO_REPLY") {
		t.Fatal("diary section is not the mood diary")
	}
}
