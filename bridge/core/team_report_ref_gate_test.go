package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core/team"
)

// #1897: a held report on a task whose handoff has a 「原件」 section keeps its attachments off the
// chat channel on a text-only release and on the unchecked post at timeout, and says so in the
// text; the same report on a task without one still posts them (#1888).
func TestHeldReportRefTaskWithholdsAttachments(t *testing.T) {
	for _, ref := range []bool{true, false} {
		for _, route := range []string{"pass", "timeout", "direct"} {
			t.Run(fmt.Sprintf("ref=%v/%s", ref, route), func(t *testing.T) {
				e, p, key := heldMediaFixture(t, "")
				notes := filepath.Join(t.TempDir(), "handoff.md")
				body := "# 交接\n## 用户原话\n- 照着原片做\n"
				if ref {
					body += "## 原件\n- 陈：原件=动图；我们=动图；证据=/tmp/x.png\n"
				}
				if err := os.WriteFile(notes, []byte(body), 0o600); err != nil {
					t.Fatal(err)
				}
				writeTaskBoard(t, e.team.dir, team.TaskBoardFile, `{"id":1885,"what":"样片","status":"在做","chat":"discord:111","ws":"discord:222","where":"`+notes+`"}`+"\n")
				switch route {
				case "pass":
					if err := e.deliverHeldReport(key, "逐条：看了四段", false); err != nil {
						t.Fatal(err)
					}
				case "timeout":
					e.recoverPendingReports(true)
				case "direct":
					e.dropHeldReport(key, "test: direct exit instead")
					e.workspaceChatForTest = func(string) bool { return true }
					e.noteWorkspaceFiles("discord:222", []FileAttachment{{FileName: "demo-v4.mp4", MimeType: "video/mp4", Data: []byte("mp4")}})
					e.postExitHeadline(e.ctx, p, "discord:111", "111", "222", "橘", team.ExitKindReport,
						"[report] #1885 背景：样片。\n第四版做好了\n要你做的：看片。\n我加的：无\n细节：无", "discord:222", 1885, "背景：样片。\n第四版做好了", e.boardItemByID(1885))
				}
				media := p.sentMedia()
				if ref && len(media) != 0 {
					t.Fatalf("reference task: attachments %q reached the chat channel without the judge", media)
				}
				if !ref && len(media) == 0 {
					t.Fatal("task without a reference lost its attachments")
				}
				said := strings.Join(p.getSent(), "\n")
				if ref && route != "direct" && !strings.Contains(said, "还没过原件对照") {
					t.Fatalf("chat text does not say the attachments were withheld:\n%s", said)
				}
			})
		}
	}
}

// The lead's acceptance turn on a reference task says the attachments leave only through ws-pass.
func TestHeldReportRefTaskLeadPrompt(t *testing.T) {
	e, p, store, item := heldFixture(t)
	notes := filepath.Join(t.TempDir(), "handoff.md")
	if err := os.WriteFile(notes, []byte("## 原件\n- 文章体例：原件=原文；我们=原文；证据=/tmp/a.md\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	item.Where = notes
	holdForTest(t, e, p, item, "")
	jobs := store.List()
	if len(jobs) != 1 || !strings.Contains(jobs[0].Prompt, fmt.Sprintf("ws-pass --id %d <附件路径…>", item.ID)) {
		t.Fatalf("lead prompt lacks the reference route: %+v", jobs)
	}
}
