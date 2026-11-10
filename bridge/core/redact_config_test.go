package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSensitiveConfigKey pins the key-name rule: credentials in, locations and
// counters out.
func TestSensitiveConfigKey(t *testing.T) {
	sensitive := []string{
		"token", "bot_token", "access_token", "app_secret", "client_secret",
		"api_key", "APIKey", "api-key", "x-api-key", "secret", "password",
		"private_key", "callback_aes_key", "encrypt_key", "corp_secret",
		"ANTHROPIC_AUTH_TOKEN", "webhook_secret", "credentials",
	}
	for _, name := range sensitive {
		if !sensitiveConfigKey(name) {
			t.Errorf("key %q should be redacted", name)
		}
	}
	kept := []string{
		"port", "path", "name", "title", "max_tokens", "min_tokens",
		"max_context_tokens", "session_key", "env_key", "token_endpoint",
		"token_url", "credentials_file", "data_dir", "app_id", "language",
	}
	for _, name := range kept {
		if sensitiveConfigKey(name) {
			t.Errorf("key %q should NOT be redacted", name)
		}
	}
}

const configRedactSample = `# top of file, keep this comment
data_dir = "/Users/someone/.bothouse"
language = "zh-CN"
title = "肥鱼"
port = 51442

[management]
port = 51442
token = "mgmt-super-secret-value"

[bridge]
token = "bridge-super-secret-value"
name = "bridge-a"
token_endpoint = "https://example.test/oauth/token"

[wecom]
corp_id = "corp-id-123"
corp_secret = "corp-secret-value"
callback_aes_key = "callback-aes-value"

[feishu]
app_id = "cli_app_id"
app_secret = "feishu-app-secret-value"
encrypt_key = "feishu-encrypt-value"

[[projects]]
name = "demo"

[projects.agent]
type = "claude"

[[projects.agent.providers]]
name = "anthropic"
api_key = "sk-ant-api-secret-value"
env_key = "ANTHROPIC_API_KEY"
max_tokens = 8192

[[projects.platforms]]
type = "telegram"

[projects.platforms.options]
token = "123456:telegram-bot-secret"
app_id = "app-id"
env = { GOOGLE_API_KEY = "google-secret-value", REGION = "us", OPENCLAW_GATEWAY_TOKEN = "gateway-secret-value" }
banned_words = ["违禁词1", "secret_project"]
rate_limit = { max_messages = 50, window_secs = 60 }
"quoted-key" = "quoted-value"
dotted.secret = "dotted-secret-value"
`

var configRedactSecrets = []string{
	"mgmt-super-secret-value",
	"bridge-super-secret-value",
	"corp-secret-value",
	"callback-aes-value",
	"feishu-app-secret-value",
	"feishu-encrypt-value",
	"sk-ant-api-secret-value",
	"123456:telegram-bot-secret",
	"google-secret-value",
	"gateway-secret-value",
	"dotted-secret-value",
}

var configRedactKept = []string{
	`data_dir = "/Users/someone/.bothouse"`,
	`language = "zh-CN"`,
	`title = "肥鱼"`,
	`port = 51442`,
	`token_endpoint = "https://example.test/oauth/token"`,
	`corp_id = "corp-id-123"`,
	`app_id = "cli_app_id"`,
	`name = "demo"`,
	`type = "claude"`,
	`env_key = "ANTHROPIC_API_KEY"`,
	`max_tokens = 8192`,
	`banned_words = ["违禁词1", "secret_project"]`,
	`rate_limit = { max_messages = 50, window_secs = 60 }`,
	`"quoted-key" = "quoted-value"`,
}

// TestRedactConfigText is the main behaviour test: credentials become "***",
// their originals are gone, and everything else — key names, order, values,
// comments, quoting — survives.
func TestRedactConfigText(t *testing.T) {
	out := redactConfigText(configRedactSample)
	if out == configRedactSample {
		t.Fatal("nothing was redacted")
	}

	for _, secret := range configRedactSecrets {
		if strings.Contains(out, secret) {
			t.Errorf("redacted output still contains secret %q\n%s", secret, out)
		}
	}
	for _, kept := range configRedactKept {
		if !strings.Contains(out, kept) {
			t.Errorf("redacted output lost/normalised a non-secret line %q\n%s", kept, out)
		}
	}

	// Key names and comments are untouched, and the field order is unchanged.
	for _, line := range []string{
		`token = "***"`,
		`app_secret = "***"`,
		`api_key = "***"`,
		`env = { GOOGLE_API_KEY = "***", REGION = "us", OPENCLAW_GATEWAY_TOKEN = "***" }`,
		`dotted.secret = "***"`,
		`# top of file, keep this comment`,
	} {
		if !strings.Contains(out, line) {
			t.Errorf("redacted output missing %q\n%s", line, out)
		}
	}

	if got, want := countLines(out), countLines(configRedactSample); got != want {
		t.Errorf("line count changed: got %d want %d\n%s", got, want, out)
	}

	// The result must still be valid TOML and pass the safety check.
	if _, err := RedactConfigText(configRedactSample); err != nil {
		t.Fatalf("RedactConfigText: %v", err)
	}
}

func countLines(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "\n") + 1
}

// TestRedactConfigText_CaseAndSeparatorVariants covers the "case/separator
// insensitive" half of the rule.
func TestRedactConfigText_CaseAndSeparatorVariants(t *testing.T) {
	in := `[a]
apiKey = "s1"
API-KEY = "s2"
Api_Key = "s3"
AppSecret = "s4"
CLIENT-SECRET = "s5"
BOTTOKEN = "s6"
password = "s7"
PassWord = "s8"
`
	out := redactConfigText(in)
	for _, secret := range []string{"s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"} {
		if strings.Contains(out, `"`+secret+`"`) {
			t.Errorf("secret %q survived\n%s", secret, out)
		}
	}
	if n := strings.Count(out, `"***"`); n != 8 {
		t.Errorf("expected 8 redacted values, got %d\n%s", n, out)
	}
}

// TestRedactConfigText_CommentsAndStringsUntouched makes sure a comment or an
// ordinary string that merely mentions "secret" is never rewritten.
func TestRedactConfigText_CommentsAndStringsUntouched(t *testing.T) {
	in := `# token = "commented-out-secret"
[display]
title = "token = not a real assignment"
note = "the word secret inside a value"
`
	out := redactConfigText(in)
	if out != in {
		t.Errorf("text without real assignments changed:\n got %q\nwant %q", out, in)
	}
}

// TestRedactConfigText_ExampleConfig runs the real example file through the
// redactor: 2400 lines with inline tables, arrays and quoted strings. It must
// come out still parseable and with every credential masked.
func TestRedactConfigText_ExampleConfig(t *testing.T) {
	path := filepath.Join("..", "config.example.toml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("example config not available: %v", err)
	}
	out, err := RedactConfigText(string(raw))
	if err != nil {
		t.Fatalf("RedactConfigText(%s): %v", path, err)
	}
	if len(out) == 0 {
		t.Fatal("empty output")
	}
	// The file's leading comment block must survive; re-encoding would drop it.
	firstLine := ""
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(line) != "" {
			firstLine = strings.TrimSpace(line)
			break
		}
	}
	if strings.HasPrefix(firstLine, "#") && !strings.Contains(out, firstLine) {
		t.Errorf("leading comment %q lost", firstLine)
	}
	// Commented-out settings are examples, not live values: they must survive
	// exactly as written.
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") && strings.Contains(line, "secret") {
			if !strings.Contains(out, line) {
				t.Errorf("commented sample line changed: %q", line)
				break
			}
		}
	}
	if countLines(out) != countLines(string(raw)) {
		t.Error("line structure changed on the example config")
	}
}

// TestRedactConfigText_EmptyAndCommentOnly covers the one case that still
// passes without a parse: an empty or comment-only file has no credentials to
// verify, so handleConfig keeps serving it as it is.
func TestRedactConfigText_EmptyAndCommentOnly(t *testing.T) {
	for _, in := range []string{"", "\n", "# only a comment\n", "\n# one\n# two\n"} {
		out, err := RedactConfigText(in)
		if err != nil {
			t.Errorf("RedactConfigText(%q) returned error: %v", in, err)
		}
		if out != in {
			t.Errorf("RedactConfigText(%q) = %q, want it unchanged", in, out)
		}
	}
}

// TestRedactConfigText_BrokenFailsClosed is the #480 half of the promise: a
// file that does not parse cannot be verified, so it errors instead of going
// out with whatever the textual pass happened to mask.
func TestRedactConfigText_BrokenFailsClosed(t *testing.T) {
	for _, in := range []string{
		"not toml at all\n",
		"token = \"unterminated\n[key\n",
		"[key\n",
		"token = supersecretvalue\n",
	} {
		out, err := RedactConfigText(in)
		if err == nil {
			t.Errorf("RedactConfigText(%q) returned %q, want an error", in, out)
			continue
		}
		if out != "" {
			t.Errorf("RedactConfigText(%q) returned %q alongside the error", in, out)
		}
		if strings.Contains(err.Error(), "supersecretvalue") {
			t.Errorf("error for %q quotes the config value: %v", in, err)
		}
	}
}

// TestRedactConfigText_Multiline covers values that span lines: an array of
// inline tables (where the credential keys sit inside elements) and a
// multi-line string that must not be touched.
func TestRedactConfigText_Multiline(t *testing.T) {
	in := `note = """
token = "this is prose, not a setting"
"""
servers = [
  { name = "a", api_key = "key-a-value", port = 1 },
  { name = "b", api_key = "key-b-value", port = 2 }, # comment
]
`
	out := redactConfigText(in)
	for _, secret := range []string{"key-a-value", "key-b-value"} {
		if strings.Contains(out, secret) {
			t.Errorf("secret %q survived:\n%s", secret, out)
		}
	}
	if n := strings.Count(out, `api_key = "***"`); n != 2 {
		t.Errorf("expected 2 masked api_key values, got %d:\n%s", n, out)
	}
	for _, kept := range []string{`token = "this is prose, not a setting"`, `name = "a"`, `port = 1`, `# comment`} {
		if !strings.Contains(out, kept) {
			t.Errorf("lost %q:\n%s", kept, out)
		}
	}
}
