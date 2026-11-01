package core

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// A handoff wake-up (ws-handoff) is the first turn of a workspace task: it gets the gate's wiki recall,
// standing practices and decisions blocks like a chat turn; a plain timer does not.
func TestExecuteTimerJob_HandoffGetsTurnContext(t *testing.T) {
	for _, handoff := range []bool{true, false} {
		var mu sync.Mutex
		var queries []string
		gate := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/context") {
				b := make([]byte, r.ContentLength)
				_, _ = r.Body.Read(b)
				mu.Lock()
				queries = append(queries, string(b))
				mu.Unlock()
				fmt.Fprint(w, `{"wiki":[{"path":"~/wiki/x.md","desc":"recall-line"},{"path":"【常驻做法 ab】","desc":"standing-line"},{"path":"【已定的方向和做法 cd】","desc":"decision-line"}]}`)
				return
			}
			fmt.Fprint(w, `{"action":"reply"}`)
		}))
		p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
		as := newResultAgentSession("done")
		e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangChinese)
		e.SetGate(gate.URL+"/decide", 1000, "reply")
		prompt := "你是工作区频道里的主角色，从主频道接手一整块大活：x。先读交接 /r/notes/x.md。先读代码地图 /m/bridge.md"
		job := &TimerJob{ID: "h", SessionKey: "discord:ws-1:user-1", Prompt: prompt, Handoff: handoff, Mute: true}
		if err := e.ExecuteTimerJob(job); err != nil {
			t.Fatal(err)
		}
		e.cancel()
		gate.Close()
		if len(as.sentPrompts) != 1 {
			t.Fatalf("handoff=%v prompts=%v", handoff, as.sentPrompts)
		}
		got := as.sentPrompts[0]
		has := strings.Contains(got, "recall-line") && strings.Contains(got, "standing-line") && strings.Contains(got, "decision-line")
		if handoff && (!has || !strings.Contains(got, "/m/bridge.md") || strings.Index(got, "recall-line") > strings.Index(got, prompt)) {
			t.Fatalf("handoff turn lacks context blocks before the prompt: %s", got)
		}
		if handoff && (len(queries) != 1 || !strings.Contains(queries[0], "/r/notes/x.md")) {
			t.Fatalf("context query must carry the prompt naming the handoff file: %v", queries)
		}
		if !handoff && (has || len(queries) != 0) {
			t.Fatalf("plain timer got context: %s %v", got, queries)
		}
	}
}
