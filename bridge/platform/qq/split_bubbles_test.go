package qq

import "testing"

func TestSplitBubbles(t *testing.T) {
	cases := map[string]int{
		"哦？\n\n我一直都在啊":          2,
		"一句话":                   1,
		"a\n\n\n\nb\n\nc":        3,
		"代码\n\n```\nx\n\ny\n```": 1,
		"第一行\n第二行":              1,
	}
	for in, want := range cases {
		if got := len(splitBubbles(in)); got != want {
			t.Errorf("%q: got %d parts, want %d", in, got, want)
		}
	}
}
