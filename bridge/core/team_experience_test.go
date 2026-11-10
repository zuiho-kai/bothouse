package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTeamExperienceLoop(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "team-experience")
	e := &Engine{}
	e.SetTeamExperience(dir, []string{"<@222>"})

	// Not a personal agent, or not a bot: nothing filed.
	e.collectExperience(&Message{FromBot: true, UserID: "333", Content: "【经验】x"})
	e.collectExperience(&Message{FromBot: false, UserID: "222", Content: "【经验】x"})
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("filed from a non-personal-agent message")
	}

	reply := "<@111> 做完了，结果见上。\n- 【经验】：Discord 测试服的隔离桥要写 allow_guilds，只写 guild_id 挡不住主服务器消息\n普通一行"
	e.collectExperience(&Message{FromBot: true, UserID: "222", UserName: "pa", SessionKey: "discord:c1", MessageID: "m1", Content: reply})
	e.collectExperience(&Message{FromBot: true, UserID: "222", UserName: "pa", SessionKey: "discord:c1", MessageID: "m1", Content: reply}) // replay
	pages, _ := filepath.Glob(filepath.Join(dir, "*.md"))
	if len(pages) != 2 { // README + one lesson
		t.Fatalf("pages = %v", pages)
	}

	out, err := e.WithExperience("<@222> 给测试服再起一个隔离桥")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "allow_guilds") || !strings.Contains(out, "来自 pa") || !strings.Contains(out, "【经验】") {
		t.Fatalf("dispatch = %q", out)
	}
	if _, err := (&Engine{}).WithExperience("x"); err == nil {
		t.Fatal("want error without team_experience_dir")
	}
	_ = time.Now
}
