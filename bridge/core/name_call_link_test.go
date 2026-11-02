package core

import "testing"

func TestLinkLeadingNames(t *testing.T) {
	ids := map[string]string{"grok娘": "1", "龙娘": "2", "彩虹猫": "3"}
	self := []string{"Claude橘", "橘"}
	m := func(id string) string { return "<@" + id + ">" }
	cases := map[string]string{
		"先找对标。\n\ngrok娘，帮我找 10 个": "先找对标。\n\n<@1>，帮我找 10 个",
		"龙娘、彩虹猫，你们看看":             "<@2>、<@3>，你们看看",
		"<@3>、龙娘 来一下":             "<@3>、<@2> 来一下",
		"龙娘刚才写的那版不错":              "龙娘刚才写的那版不错",
		"刚才 grok娘，帮我":             "刚才 grok娘，帮我",
		"橘，我自己来":                  "橘，我自己来",
		"```\ngrok娘，帮我\n```":      "```\ngrok娘，帮我\n```",
		"  grok娘帮我看下":             "  <@1>帮我看下",
	}
	for in, want := range cases {
		if got := LinkLeadingNames(in, ids, self, m); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}
