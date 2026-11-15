package cloudweb

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// testdata/mentions_js.json: every call the plugin's mentions.test.mjs made to its JS parser
// (dsh/collab/mentions.mjs, removed in #1662) with the answer it gave, plus forMember/forDisplay of
// each text for every member. The Go rule must give the same answers.
func TestMentionsMatchRemovedPluginRule(t *testing.T) {
	raw, err := os.ReadFile("testdata/mentions_js.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Fn      string          `json:"fn"`
		Text    string          `json:"text"`
		To      hubMember       `json:"to"`
		Members []hubMember     `json:"members"`
		Out     json.RawMessage `json:"out"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for i, c := range cases {
		var got any
		switch c.Fn {
		case "mentions":
			ids := []string{}
			for id := range mentionedIDs(c.Text, c.Members) {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			got = ids
		case "forDisplay":
			got = mentionsForDisplay(c.Text, c.Members)
		case "forMember":
			got = mentionsForMember(c.Text, c.To, c.Members)
		case "split":
			parts := [][]string{}
			for _, p := range splitMentions(c.Text, c.Members) {
				parts = append(parts, []string{p.text, p.id})
			}
			got = parts
		}
		var want any
		switch c.Fn {
		case "mentions":
			var w []string
			_ = json.Unmarshal(c.Out, &w)
			if w == nil {
				w = []string{}
			}
			want = w
		case "split":
			var w [][]string
			_ = json.Unmarshal(c.Out, &w)
			want = w
		default:
			var w string
			_ = json.Unmarshal(c.Out, &w)
			want = w
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("case %d %s(%q, to=%s): got %#v, want %#v", i, c.Fn, c.Text, c.To.ID, got, want)
		}
	}
}

// #271: the parse stays linear on the plugin's largest texts.
func TestMentionsLinear(t *testing.T) {
	members := []hubMember{{ID: "dsh", Name: "肥鱼"}, {ID: "gge", Name: "G哥"}}
	onePerLine := strings.Repeat("`\n", 65536)[:131071]
	started := time.Now()
	if got := mentionedIDs(onePerLine, members); len(got) != 0 {
		t.Fatalf("one backtick per line: %v", got)
	}
	if d := time.Since(started); d > 2*time.Second {
		t.Fatalf("one backtick per line took %s", d)
	}
	named := strings.Repeat("`@肥鱼\n", 32767)
	if got := mentionedIDs(named, members); !got["dsh"] || len(got) != 1 {
		t.Fatalf("named lines: %v", got)
	}
	parts := []string{"[^0]: 注注释说明补充\n见 [^1]"}
	for i := 1; i < 4759; i++ {
		parts = append(parts, "[^"+strconv.Itoa(i)+"]: 注注释说明补充\n见 [^"+strconv.Itoa(i+1)+"]")
	}
	parts = append(parts, "[^4759]: 注 @肥鱼", "见 [^0]")
	started = time.Now()
	if got := mentionedIDs(strings.Join(parts, "\n\n"), members); !got["dsh"] || len(got) != 1 {
		t.Fatalf("footnote chain: %v", got)
	}
	if d := time.Since(started); d > 2*time.Second {
		t.Fatalf("footnote chain took %s", d)
	}
}

// The channel page's parity specs (dsh/packages/client-ui-discord/tests/backend-mentions.ts) compare the
// page's colouring with these answers; the bridge must give each of them.
func TestPageParityFixtureMatchesBridge(t *testing.T) {
	raw, err := os.ReadFile("../../../dsh/packages/client-ui-discord/tests/backend-mentions.json")
	if err != nil {
		t.Fatal(err)
	}
	var table map[string][]string
	if err := json.Unmarshal(raw, &table); err != nil {
		t.Fatal(err)
	}
	for k, want := range table {
		var key []json.RawMessage
		var text string
		var members []hubMember
		if json.Unmarshal([]byte(k), &key) != nil || len(key) != 2 || json.Unmarshal(key[0], &text) != nil || json.Unmarshal(key[1], &members) != nil {
			t.Fatalf("bad key %s", k)
		}
		got := []string{}
		for id := range mentionedIDs(text, members) {
			got = append(got, id)
		}
		sort.Strings(got)
		if want == nil {
			want = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%q: bridge calls %v, page specs expect %v", text, got, want)
		}
	}
}

// Moved from dsh/collab/collab.test.mjs "mentions: own mention removed, others rewritten" (#1662);
// its name-call half is core.NameCalled (platform/discord/mentions_test.go TestNameCalled).
func TestMentionsForMemberAndDisplay(t *testing.T) {
	members := []hubMember{{ID: "ju", Name: "橘", MentionID: "111"}, {ID: "ds", Name: "DeepSeek"}}
	ju, ds := members[0], members[1]
	if got := mentionedIDs("@橘 看下 @DeepSeek", members); !got["ju"] || !got["ds"] || len(got) != 2 {
		t.Fatalf("mentions: %v", got)
	}
	if got := mentionedIDs("```\n@橘\n```", members); len(got) != 0 {
		t.Fatalf("fenced: %v", got)
	}
	for _, c := range []struct {
		text string
		to   hubMember
		want string
	}{
		{"@橘 看下这个", ju, "看下这个"},
		{"@橘 和 @DeepSeek 一起看", ju, "@橘(你) 和 @DeepSeek 一起看"},
		{"@DeepSeek 叫 <@111>", ds, "@DeepSeek(你) 叫 <@111>"},
		{"@DeepSeek 你好", ds, "你好"},
	} {
		if got := mentionsForMember(c.text, c.to, members); got != c.want {
			t.Errorf("forMember(%q, %s) = %q, want %q", c.text, c.to.ID, got, c.want)
		}
	}
	if got := mentionsForDisplay("<@111> 你好", members); got != "@橘 你好" {
		t.Fatalf("display: %q", got)
	}
}
