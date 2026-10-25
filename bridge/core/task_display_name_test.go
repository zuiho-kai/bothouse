package core

import (
	"context"
	"net/http"
	"testing"
)

// Cards show each bot's configured name (team_name), not its project id: the
// executor field and bot member rows, even when the channel binding was made by
// /bind (which stores the project id as the name) or the row predates this.
func TestTaskCardShowsProjectDisplayNames(t *testing.T) {
	p, lead, _, api, rm := memberIdentityFixture(t)
	api.engines["fish"].SetTeam("", "橘", false)
	api.engines["gjiang"].SetTeam("", "龙娘", false)
	rm.Bind("discord", "room", map[string]string{})
	rm.AddToBind("discord", "room", "fish")
	rm.AddToBind("discord", "room", "gjiang") // Bots["gjiang"] = "gjiang"
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	if _, status := assignMemberHTTP(t, api, TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "w", ReporterProject: "gjiang", Title: "Check"}); status != http.StatusOK {
		t.Fatal("assignment rejected", status)
	}
	stored, _ := p.Task(id)
	if stored.Members[0].Name != "龙娘" {
		t.Fatalf("member name = %q, want team_name", stored.Members[0].Name)
	}
	if stored.Agent != "fish" {
		t.Fatalf("stored executor = %q, want the project id kept", stored.Agent)
	}
	// A row stored with the id as its name (before this fix) is shown by name too.
	r := p.runs[run]
	r.mu.Lock()
	r.record.Task.Members = append(r.record.Task.Members, TaskMember{ReporterProject: "gjiang", ID: "old", Name: "gjiang", Title: "Old", Status: "queued"},
		TaskMember{ReporterProject: "fish", ID: "native", Name: "Child A", Title: "Own", Status: "queued"})
	r.record.Task.Seq++
	r.mu.Unlock()
	p.Flush(context.Background())
	lead.pm.Lock()
	card := lead.snapshots[id]
	lead.pm.Unlock()
	if card == nil {
		t.Fatal("card not published")
	}
	if card.Agent != "橘" {
		t.Fatalf("card executor = %q, want 橘", card.Agent)
	}
	want := []string{"龙娘", "龙娘", "Child A"}
	for i, m := range card.Members {
		if m.Name != want[i] {
			t.Fatalf("card member %d = %q, want %q", i, m.Name, want[i])
		}
	}
	if again, _ := p.Task(id); again.Agent != "fish" || again.Members[1].Name != "gjiang" {
		t.Fatal("display names leaked into the stored record")
	}
}

func TestProjectDisplayNameFallsBack(t *testing.T) {
	e := &Engine{name: "maomao"}
	if got := e.projectDisplayName("maomao"); got != "maomao" {
		t.Fatalf("no team_name: got %q, want project id", got)
	}
	if got := e.projectDisplayName("unknown"); got != "" {
		t.Fatalf("unknown project without relay: got %q", got)
	}
	e.SetTeam("", "橘", false)
	if got := e.projectDisplayName("maomao"); got != "橘" {
		t.Fatalf("got %q, want 橘", got)
	}
}
