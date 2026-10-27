package core

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// #534: workspace identity survives release, renaming and a state reload. Exercise
// the real claim operation and HTTP handler, including their persisted side effects.
func TestTeamWorkspaceClaimIdentity534(t *testing.T) {
	for _, viaHTTP := range []bool{false, true} {
		entry := "direct"
		if viaHTTP {
			entry = "http"
		}
		t.Run(entry, func(t *testing.T) {
			for _, tc := range []struct {
				name, source, target string
				seed, released       bool
				reject               bool
			}{
				{"active_workspace", "201", "205", true, false, true},
				{"released_workspace", "201", "205", true, true, true},
				{"platform_name_without_history", "201", "205", false, false, true},
				{"ordinary_chat", "200", "205", false, false, false},
				{"same_target_again", "200", "201", true, false, false},
				{"self_claim", "200", "200", false, false, true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					g := newWorkspaceGuild()
					p := &claimingGuild{fakeWorkspaceGuild: g}
					e := newWorkspaceLead(t, g, t.TempDir())
					e.platforms = []Platform{p}
					e.teamWS = newTeamWorkspaces()
					e.handoffWatchOn.Store(true)
					path := teamWorkspacePath(e.dataDir)
					if err := teamWorkspaceStoreList(path, "discord:200", nil); err != nil {
						t.Fatal(err)
					}
					if tc.seed {
						if err := e.ClaimTeamWorkspaceFor("discord:200", "201", "工作区1", "owner", "seed"); err != nil {
							t.Fatal(err)
						}
						// Names alone must not determine recorded workspace identity.
						g.channels[2].Name = "renamed"
						if tc.released {
							if !e.releaseTeamWorkspace("discord:201", time.Now(), false) {
								t.Fatal("workspace was not released")
							}
							if _, ok := e.WorkspaceParent("discord:201"); ok {
								t.Fatal("released workspace still has a parent")
							}
						}
					}
					forgetWorkspaceCache(e.dataDir)
					before, err := os.ReadFile(path)
					if err != nil {
						t.Fatal(err)
					}
					claimsBefore := len(p.claims)
					source := "discord:" + tc.source + ":user"
					if viaHTTP {
						s := &APIServer{engines: map[string]*Engine{"lead": e}}
						rec := httptest.NewRecorder()
						req := httptest.NewRequest(http.MethodPost, "/team/workspace/claim",
							strings.NewReader(`{"session_key":"`+source+`","workspace_id":"`+tc.target+`","owner":"worker","title":"identity regression"}`))
						s.handleTeamWorkspaceClaim(rec, req)
						want := http.StatusOK
						if tc.reject {
							want = http.StatusBadRequest
						}
						if rec.Code != want {
							t.Fatalf("HTTP claim = %d %s, want %d", rec.Code, rec.Body.String(), want)
						}
						if tc.reject && tc.source != tc.target && !strings.Contains(rec.Body.String(), "chat channel") {
							t.Fatalf("missing actionable chat-channel instruction: %s", rec.Body.String())
						}
					} else {
						err := e.ClaimTeamWorkspaceFor(source, tc.target, "工作区5", "worker", "identity regression")
						if tc.reject {
							if tc.source == tc.target {
								if err == nil || !strings.Contains(err.Error(), "itself") {
									t.Fatalf("self claim = %v", err)
								}
							} else if !errors.Is(err, errTeamIsWorkspace) || !strings.Contains(err.Error(), "chat channel") {
								t.Fatalf("workspace claim = %v, want actionable errTeamIsWorkspace", err)
							}
						} else if err != nil {
							t.Fatal(err)
						}
					}
					if tc.reject {
						after, err := os.ReadFile(path)
						if err != nil {
							t.Fatal(err)
						}
						if string(before) != string(after) {
							t.Fatal("rejected claim changed Parents, Handoffs or watch state")
						}
						if len(p.claims) != claimsBefore {
							t.Fatal("rejected claim reached the platform claimer")
						}
						return
					}
					if parent, ok := e.WorkspaceParent("discord:" + tc.target); !ok || parent != "discord:200" {
						t.Fatalf("claimed target parent = %q, %v", parent, ok)
					}
					hs := handoffsOf(e, "discord:"+tc.target)
					h := hs[len(hs)-1]
					if h.Chat != "discord:200" || h.Owner != "worker" || h.Title != "identity regression" || h.Due.IsZero() {
						t.Fatalf("successful claim did not preserve handoff/watch behavior: %+v", h)
					}
				})
			}
		})
	}
}

func TestTeamWorkspacePlanReleasedIdentity534(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	if err := e.ClaimTeamWorkspaceFor("discord:200", "201", "工作区1", "", "seed"); err != nil {
		t.Fatal(err)
	}
	e.releaseTeamWorkspace("discord:201", time.Now(), false)
	g.channels[2].Name = "renamed"
	forgetWorkspaceCache(e.dataDir)
	if _, _, err := e.teamWorkspaceOp("discord:201", true); !errors.Is(err, errTeamIsWorkspace) {
		t.Fatalf("new from released workspace = %v, want errTeamIsWorkspace", err)
	}
}
