package core

import (
	"fmt"
	"strings"

	"github.com/BurntSushi/toml"
)

// RedactConfigText returns raw TOML with the values of credential-looking keys
// replaced by "***". Everything else — table headers, key order, comments,
// spacing — is left byte-for-byte alone, because the panel's 配置 page shows
// this text as-is (#710 件3).
//
// The values are found textually rather than by re-encoding the parsed config:
// re-encoding would drop every comment in the file.
func RedactConfigText(raw string) (string, error) {
	out := redactConfigText(raw)
	if err := verifyConfigRedaction(raw, out); err != nil {
		return "", err
	}
	return out, nil
}

// sensitiveConfigKey reports whether a single TOML key name holds a credential.
//
// The rule is the one #710 件3 asks for — by key name, case and separators
// irrelevant (api_key / apiKey / API-KEY all hit) — plus the AES/signing keys
// the example config carries (encrypt_key, callback_aes_key, EncodingAESKey),
// which are credentials too. Names that point at *where* something lives
// (token_endpoint, token_url, credentials_file, session_key, env_key) are not
// secret material and stay as they are.
func sensitiveConfigKey(name string) bool {
	n := normalizeConfigKey(name)
	if n == "" {
		return false
	}
	for _, suffix := range []string{"file", "path", "dir", "url", "uri", "endpoint", "host", "port"} {
		if strings.HasSuffix(n, suffix) {
			return false
		}
	}
	for _, sub := range []string{"secret", "password", "passwd", "credential", "apikey", "privatekey", "accesskey"} {
		if strings.Contains(n, sub) {
			return true
		}
	}
	// token / bot_token / access_token / ANTHROPIC_AUTH_TOKEN, and the AES and
	// signing keys, which all end in -key but are not "apikey"-shaped.
	for _, suffix := range []string{"token", "aeskey", "encryptkey", "signkey", "signingkey"} {
		if strings.HasSuffix(n, suffix) {
			return true
		}
	}
	return false
}

// normalizeConfigKey lowercases a key and drops every separator, so that
// "api_key", "apiKey", "API-KEY" and "APIKey" all become "apikey".
func normalizeConfigKey(name string) string {
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		switch {
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r + ('a' - 'A'))
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		}
	}
	return b.String()
}

// redactConfigText walks the file line by line. Only `key = value` assignments
// are rewritten; every other byte is copied as it is.
func redactConfigText(raw string) string {
	var b strings.Builder
	b.Grow(len(raw))
	pos := 0
	atLineStart := true
	for pos < len(raw) {
		c := raw[pos]
		switch {
		case c == '\n':
			b.WriteByte(c)
			pos++
			atLineStart = true
		case c == ' ' || c == '\t' || c == '\r':
			b.WriteByte(c)
			pos++
		case c == '#':
			b.WriteString(raw[pos:endOfConfigLine(raw, pos)])
			pos = endOfConfigLine(raw, pos)
			atLineStart = false
		case atLineStart:
			valueStart, valueEnd, keyName, ok := parseConfigAssignment(raw, pos)
			if !ok {
				b.WriteByte(c)
				pos++
				atLineStart = false
				continue
			}
			b.WriteString(raw[pos:valueStart])
			b.WriteString(redactConfigMemberValue(keyName, raw[valueStart:valueEnd]))
			pos = valueEnd
		default:
			b.WriteByte(c)
			pos++
			atLineStart = false
		}
	}
	return b.String()
}

// redactConfigMemberValue masks one assignment's value: a credential key gets
// "***", an inline table or array is walked so nested keys are masked too, and
// a plain scalar is returned untouched.
func redactConfigMemberValue(keyName, value string) string {
	if sensitiveConfigKey(keyName) {
		return `"***"`
	}
	trimmed := strings.TrimLeft(value, " \t")
	lead := value[:len(value)-len(trimmed)]
	switch {
	case strings.HasPrefix(trimmed, "{"):
		if end, ok := skipConfigBalanced(trimmed, 0); ok && end == len(trimmed) {
			return lead + redactInlineTableText(trimmed)
		}
	case strings.HasPrefix(trimmed, "["):
		if end, ok := skipConfigBalanced(trimmed, 0); ok && end == len(trimmed) {
			return lead + redactArrayText(trimmed)
		}
	}
	return value
}

// parseConfigAssignment parses `key = value` starting at pos (the first
// non-space byte of a line) and returns the value's byte span and the key's
// last dotted segment. ok is false when the line is not an assignment — table
// headers, blank lines, prose.
func parseConfigAssignment(raw string, pos int) (valueStart, valueEnd int, keyName string, ok bool) {
	i := pos
	for {
		if i >= len(raw) {
			return 0, 0, "", false
		}
		switch raw[i] {
		case '"', '\'':
			name, next, keyOK := readConfigQuotedKey(raw, i)
			if !keyOK {
				return 0, 0, "", false
			}
			keyName, i = name, next
		default:
			start := i
			for i < len(raw) && isConfigBareKeyChar(raw[i]) {
				i++
			}
			if i == start {
				return 0, 0, "", false
			}
			keyName = raw[start:i]
		}
		j := i
		for j < len(raw) && (raw[j] == ' ' || raw[j] == '\t') {
			j++
		}
		if j < len(raw) && raw[j] == '.' {
			i = j + 1
			continue
		}
		if j >= len(raw) || raw[j] != '=' {
			return 0, 0, "", false
		}
		i = j + 1
		break
	}
	for i < len(raw) && (raw[i] == ' ' || raw[i] == '\t') {
		i++
	}
	return i, scanConfigValue(raw, i), keyName, true
}

func isConfigBareKeyChar(c byte) bool {
	switch {
	case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		return true
	case c == '_' || c == '-':
		return true
	case c >= 0x80: // TOML allows non-ASCII bare keys
		return true
	}
	return false
}

// readConfigQuotedKey reads one quoted key segment and returns its text.
func readConfigQuotedKey(raw string, pos int) (string, int, bool) {
	quote := raw[pos]
	var b strings.Builder
	i := pos + 1
	for i < len(raw) {
		c := raw[i]
		if c == '\\' && quote == '"' && i+1 < len(raw) {
			b.WriteByte(raw[i+1])
			i += 2
			continue
		}
		if c == '\n' {
			return "", 0, false
		}
		if c == quote {
			return b.String(), i + 1, true
		}
		b.WriteByte(c)
		i++
	}
	return "", 0, false
}

// scanConfigValue returns the index just past the value starting at i. A value
// that never terminates (a broken file) is cut at the end of its line so the
// rest of the file still gets walked.
func scanConfigValue(raw string, i int) int {
	if i >= len(raw) {
		return i
	}
	switch {
	case strings.HasPrefix(raw[i:], `"""`), strings.HasPrefix(raw[i:], `'''`):
		end, ok := skipConfigMultilineString(raw, i)
		if !ok {
			return endOfConfigLine(raw, i)
		}
		return end
	case raw[i] == '"', raw[i] == '\'':
		end, ok := skipConfigString(raw, i)
		if !ok {
			return endOfConfigLine(raw, i)
		}
		return end
	case raw[i] == '[', raw[i] == '{':
		end, ok := skipConfigBalanced(raw, i)
		if !ok {
			return endOfConfigLine(raw, i)
		}
		return end
	default:
		j := i
		for j < len(raw) && raw[j] != '\n' && raw[j] != '#' {
			j++
		}
		for j > i && (raw[j-1] == ' ' || raw[j-1] == '\t' || raw[j-1] == '\r') {
			j--
		}
		return j
	}
}

func endOfConfigLine(raw string, i int) int {
	for i < len(raw) && raw[i] != '\n' {
		i++
	}
	return i
}

// skipConfigString skips a single-line basic or literal string.
func skipConfigString(raw string, i int) (int, bool) {
	quote := raw[i]
	j := i + 1
	for j < len(raw) {
		c := raw[j]
		if c == '\\' && quote == '"' {
			j += 2
			continue
		}
		if c == '\n' {
			return j, false
		}
		if c == quote {
			return j + 1, true
		}
		j++
	}
	return j, false
}

// skipConfigMultilineString skips a """...""" or ”'...”' string.
func skipConfigMultilineString(raw string, i int) (int, bool) {
	delim := raw[i : i+3]
	j := i + 3
	for j < len(raw) {
		if delim == `"""` && raw[j] == '\\' {
			j += 2
			continue
		}
		if strings.HasPrefix(raw[j:], delim) {
			return j + 3, true
		}
		j++
	}
	return j, false
}

// skipConfigBalanced skips an array or inline table, honouring nested strings,
// nested brackets and comments inside the array.
func skipConfigBalanced(raw string, i int) (int, bool) {
	var stack []byte
	j := i
	for j < len(raw) {
		switch {
		case strings.HasPrefix(raw[j:], `"""`), strings.HasPrefix(raw[j:], `'''`):
			next, ok := skipConfigMultilineString(raw, j)
			if !ok {
				return next, false
			}
			j = next
		case raw[j] == '"', raw[j] == '\'':
			next, ok := skipConfigString(raw, j)
			if !ok {
				return next, false
			}
			j = next
		case raw[j] == '#':
			j = endOfConfigLine(raw, j)
		case raw[j] == '[':
			stack = append(stack, ']')
			j++
		case raw[j] == '{':
			stack = append(stack, '}')
			j++
		case raw[j] == ']', raw[j] == '}':
			if len(stack) == 0 || stack[len(stack)-1] != raw[j] {
				return j, false
			}
			stack = stack[:len(stack)-1]
			j++
			if len(stack) == 0 {
				return j, true
			}
		default:
			j++
		}
	}
	return j, false
}

// configEdit is one in-place replacement inside a config value.
type configEdit struct {
	start, end int
	text       string
}

func applyConfigEdits(s string, edits []configEdit) string {
	if len(edits) == 0 {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	pos := 0
	for _, e := range edits {
		if e.start < pos || e.end > len(s) {
			continue
		}
		b.WriteString(s[pos:e.start])
		b.WriteString(e.text)
		pos = e.end
	}
	b.WriteString(s[pos:])
	return b.String()
}

// redactInlineTableText masks the credential members of `{ k = v, ... }` by
// replacing only their value spans, so key text, spacing and separators stay
// exactly as written.
func redactInlineTableText(v string) string {
	end, ok := skipConfigBalanced(v, 0)
	if !ok || end != len(v) {
		return v
	}
	var edits []configEdit
	for _, m := range splitConfigTopLevelSpan(v[1:len(v)-1], ',', 1) {
		if m.text == "" {
			continue
		}
		eq, ok := findConfigTopLevel(m.text, '=')
		if !ok {
			continue
		}
		keyText := m.text[:eq]
		valueText := m.text[eq+1:]
		valueOffset := m.start + eq + 1
		trimmed := strings.TrimSpace(valueText)
		if trimmed == "" {
			continue
		}
		valueStart := valueOffset + strings.Index(valueText, trimmed)
		valueEnd := valueStart + len(trimmed)
		if sensitiveConfigKey(lastConfigKeySegment(keyText)) {
			edits = append(edits, configEdit{valueStart, valueEnd, `"***"`})
			continue
		}
		switch {
		case strings.HasPrefix(trimmed, "{"):
			edits = append(edits, configEdit{valueStart, valueEnd, redactInlineTableText(trimmed)})
		case strings.HasPrefix(trimmed, "["):
			edits = append(edits, configEdit{valueStart, valueEnd, redactArrayText(trimmed)})
		}
	}
	return applyConfigEdits(v, edits)
}

// redactArrayText walks the elements of `[ ... ]` in place, so an array of
// inline tables gets its credential members masked too. Plain elements — the
// banned-words list, for instance — are copied unchanged.
func redactArrayText(v string) string {
	end, ok := skipConfigBalanced(v, 0)
	if !ok || end != len(v) {
		return v
	}
	var edits []configEdit
	for _, e := range splitConfigTopLevelSpan(v[1:len(v)-1], ',', 1) {
		trimmed := strings.TrimSpace(e.text)
		if trimmed == "" {
			continue
		}
		lead := len(e.text) - len(strings.TrimLeft(e.text, " \t"))
		switch {
		case strings.HasPrefix(trimmed, "{"):
			if n, ok := skipConfigBalanced(trimmed, 0); ok && n == len(trimmed) {
				start := e.start + lead
				edits = append(edits, configEdit{start, start + n, redactInlineTableText(trimmed)})
			}
		case strings.HasPrefix(trimmed, "["):
			if n, ok := skipConfigBalanced(trimmed, 0); ok && n == len(trimmed) {
				start := e.start + lead
				edits = append(edits, configEdit{start, start + n, redactArrayText(trimmed)})
			}
		}
	}
	return applyConfigEdits(v, edits)
}

// lastConfigKeySegment returns the last dotted segment of a key, unquoted.
func lastConfigKeySegment(keyText string) string {
	parts := splitConfigTopLevel(strings.TrimSpace(keyText), '.')
	last := strings.TrimSpace(parts[len(parts)-1])
	if len(last) >= 2 {
		if (last[0] == '"' && last[len(last)-1] == '"') || (last[0] == '\'' && last[len(last)-1] == '\'') {
			last = last[1 : len(last)-1]
		}
	}
	return last
}

// configSpan is a slice of a string together with its offset in the parent.
type configSpan struct {
	start int
	text  string
}

// splitConfigTopLevel splits s on sep, ignoring separators inside strings,
// arrays, inline tables and comments.
func splitConfigTopLevel(s string, sep byte) []string {
	spans := splitConfigTopLevelSpan(s, sep, 0)
	out := make([]string, len(spans))
	for i, sp := range spans {
		out[i] = sp.text
	}
	return out
}

// splitConfigTopLevelSpan is splitConfigTopLevel for callers that need to know
// where each piece sits inside the parent string (offset adds parent's start).
func splitConfigTopLevelSpan(s string, sep byte, offset int) []configSpan {
	var spans []configSpan
	start := 0
	j := 0
	for j < len(s) {
		next, advanced, ok := skipConfigToken(s, j)
		if advanced {
			if !ok {
				return append(spans, configSpan{start: offset + start, text: s[start:]})
			}
			j = next
			continue
		}
		if s[j] == sep {
			spans = append(spans, configSpan{start: offset + start, text: s[start:j]})
			start = j + 1
		}
		j++
	}
	return append(spans, configSpan{start: offset + start, text: s[start:]})
}

// findConfigTopLevel returns the index of the first sep outside strings,
// arrays, inline tables and comments.
func findConfigTopLevel(s string, sep byte) (int, bool) {
	j := 0
	for j < len(s) {
		next, advanced, ok := skipConfigToken(s, j)
		if advanced {
			if !ok {
				return 0, false
			}
			j = next
			continue
		}
		if s[j] == sep {
			return j, true
		}
		j++
	}
	return 0, false
}

// skipConfigToken skips one string, array or inline table starting at j.
// advanced is false when s[j] starts nothing that needs skipping.
func skipConfigToken(s string, j int) (next int, advanced, ok bool) {
	switch {
	case strings.HasPrefix(s[j:], `"""`), strings.HasPrefix(s[j:], `'''`):
		n, good := skipConfigMultilineString(s, j)
		return n, true, good
	case s[j] == '"', s[j] == '\'':
		n, good := skipConfigString(s, j)
		return n, true, good
	case s[j] == '[', s[j] == '{':
		n, good := skipConfigBalanced(s, j)
		return n, true, good
	case s[j] == '#':
		return endOfConfigLine(s, j), true, true
	}
	return j, false, true
}

// verifyConfigRedaction re-parses the original and the redacted text and makes
// sure every credential-looking key really came out as "***". Without this a
// scanner miss would silently leak, which is the one failure mode that matters
// here. A file that does not parse cannot be verified and is left to the
// textual pass.
func verifyConfigRedaction(orig, redacted string) error {
	if strings.TrimSpace(orig) == "" {
		return nil
	}
	var origMap map[string]any
	if _, err := toml.Decode(orig, &origMap); err != nil {
		return nil
	}
	want := sensitiveConfigValues(origMap)
	if len(want) == 0 {
		return nil
	}
	var redMap map[string]any
	if _, err := toml.Decode(redacted, &redMap); err != nil {
		return fmt.Errorf("redacted config no longer parses: %w", err)
	}
	got := sensitiveConfigValues(redMap)
	var missing []string
	for path, wantValue := range want {
		if _, isString := wantValue.(string); !isString {
			continue // non-string values are not credentials; masking them is enough
		}
		v, ok := got[path]
		if !ok {
			missing = append(missing, path+" (gone)")
			continue
		}
		if s, isStringV := v.(string); !isStringV || s != "***" {
			missing = append(missing, path)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("config redaction missed %s", strings.Join(missing, ", "))
	}
	return nil
}

// sensitiveConfigValues maps "a.b.c" -> value for every credential-looking key
// in a decoded config. Array elements share their parent's path.
func sensitiveConfigValues(root map[string]any) map[string]any {
	out := map[string]any{}
	var walk func(v any, path []string)
	walk = func(v any, path []string) {
		switch t := v.(type) {
		case map[string]any:
			for k, vv := range t {
				walk(vv, append(append([]string{}, path...), k))
			}
		case []map[string]any:
			for _, m := range t {
				walk(m, path)
			}
		case []any:
			for _, e := range t {
				walk(e, path)
			}
		default:
			if len(path) > 0 && sensitiveConfigKey(path[len(path)-1]) {
				out[strings.Join(path, ".")] = v
			}
		}
	}
	walk(root, nil)
	return out
}
