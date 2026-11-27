package feishu

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

// parseInlineMarkdown parses a single line of markdown into Feishu post elements.
// Supports **bold** and `code` inline formatting.
func parseInlineMarkdown(line string) []map[string]any {
	type markerDef struct {
		pattern string
		tag     string
		style   string // for text elements with style
	}
	markers := []markerDef{
		{pattern: "**", tag: "text", style: "bold"},
		{pattern: "~~", tag: "text", style: "lineThrough"},
		{pattern: "`", tag: "text", style: "code"},
		{pattern: "*", tag: "text", style: "italic"},
	}

	var elements []map[string]any
	remaining := line

	for len(remaining) > 0 {
		// Check for link [text](url)
		linkIdx := strings.Index(remaining, "[")
		if linkIdx >= 0 {
			parenClose := -1
			bracketClose := strings.Index(remaining[linkIdx:], "](")
			if bracketClose >= 0 {
				bracketClose += linkIdx
				parenClose = strings.Index(remaining[bracketClose+2:], ")")
				if parenClose >= 0 {
					parenClose += bracketClose + 2
				}
			}
			if parenClose >= 0 {
				// Check if any marker comes before this link
				foundEarlierMarker := false
				for _, m := range markers {
					idx := strings.Index(remaining, m.pattern)
					if idx >= 0 && idx < linkIdx {
						foundEarlierMarker = true
						break
					}
				}
				if !foundEarlierMarker {
					linkText := remaining[linkIdx+1 : bracketClose]
					linkURL := remaining[bracketClose+2 : parenClose]
					if isValidFeishuHref(linkURL) {
						if linkIdx > 0 {
							elements = append(elements, map[string]any{"tag": "text", "text": remaining[:linkIdx]})
						}
						elements = append(elements, map[string]any{
							"tag":  "a",
							"text": linkText,
							"href": linkURL,
						})
						remaining = remaining[parenClose+1:]
						continue
					}
				}
			}
		}

		// Find the earliest formatting marker
		bestIdx := -1
		var bestMarker markerDef
		for _, m := range markers {
			idx := strings.Index(remaining, m.pattern)
			if idx < 0 {
				continue
			}
			// For single * marker, skip if it's actually ** (bold)
			if m.pattern == "*" && idx+1 < len(remaining) && remaining[idx+1] == '*' {
				idx = findSingleAsterisk(remaining)
				if idx < 0 {
					continue
				}
			}
			if bestIdx < 0 || idx < bestIdx {
				bestIdx = idx
				bestMarker = m
			}
		}

		if bestIdx < 0 {
			if remaining != "" {
				elements = append(elements, map[string]any{"tag": "text", "text": remaining})
			}
			break
		}

		if bestIdx > 0 {
			elements = append(elements, map[string]any{"tag": "text", "text": remaining[:bestIdx]})
		}
		remaining = remaining[bestIdx+len(bestMarker.pattern):]

		closeIdx := strings.Index(remaining, bestMarker.pattern)
		// For single *, make sure we don't match ** as close
		if bestMarker.pattern == "*" {
			closeIdx = findSingleAsterisk(remaining)
		}
		if closeIdx < 0 {
			elements = append(elements, map[string]any{"tag": "text", "text": bestMarker.pattern + remaining})
			remaining = ""
			break
		}

		inner := remaining[:closeIdx]
		remaining = remaining[closeIdx+len(bestMarker.pattern):]

		elements = append(elements, map[string]any{
			"tag":   bestMarker.tag,
			"text":  inner,
			"style": []string{bestMarker.style},
		})
	}

	return elements
}

// hasComplexMarkdown detects code blocks or tables that require card rendering.
func hasComplexMarkdown(s string) bool {
	if strings.Contains(s, "```") {
		return true
	}
	// Table: line starting and ending with |
	for _, line := range strings.Split(s, "\n") {
		trimmed := strings.TrimSpace(line)
		if len(trimmed) > 1 && trimmed[0] == '|' && trimmed[len(trimmed)-1] == '|' {
			return true
		}
	}
	return false
}

// extractPostPlainText extracts plain text from a Lark post (rich text) JSON content.
func extractPostPlainText(content string) string {
	var post struct {
		Content [][]struct {
			Tag      string `json:"tag"`
			Text     string `json:"text"`
			Href     string `json:"href,omitempty"`
			Language string `json:"language,omitempty"`
			UserId   string `json:"user_id,omitempty"`
			UserName string `json:"user_name,omitempty"`
		} `json:"content"`
		Title string `json:"title"`
	}
	// Post content may be wrapped in a locale key like {"zh_cn": {...}}.
	// Try direct parse first, then try extracting from locale wrapper.
	if err := json.Unmarshal([]byte(content), &post); err != nil || len(post.Content) == 0 {
		var localeWrapper map[string]json.RawMessage
		if err2 := json.Unmarshal([]byte(content), &localeWrapper); err2 == nil {
			for _, v := range localeWrapper {
				if err3 := json.Unmarshal(v, &post); err3 == nil && len(post.Content) > 0 {
					break
				}
			}
		}
	}
	if len(post.Content) == 0 {
		return ""
	}
	var parts []string
	if post.Title != "" {
		parts = append(parts, post.Title)
	}
	for _, para := range post.Content {
		var line []string
		for _, elem := range para {
			switch elem.Tag {
			case "text":
				if elem.Text != "" {
					line = append(line, elem.Text)
				}
			case "a":
				if elem.Text != "" && elem.Href != "" {
					line = append(line, fmt.Sprintf("[%s](%s)", elem.Text, elem.Href))
				} else if elem.Text != "" {
					line = append(line, elem.Text)
				}
			case "markdown":
				if elem.Text != "" {
					line = append(line, elem.Text)
				}
			case "at":
				switch {
				case elem.UserId == "all":
					line = append(line, "@all")
				case elem.UserName != "":
					line = append(line, "@"+elem.UserName)
				case elem.UserId != "":
					line = append(line, "@user")
				}
			case "img":
				line = append(line, "[image]")
			case "code_block":
				if elem.Text != "" {
					lang := elem.Language
					line = append(line, "```"+lang+"\n"+elem.Text+"\n```")
				}
			}
		}
		if len(line) > 0 {
			parts = append(parts, strings.Join(line, ""))
		}
	}
	return strings.Join(parts, "\n")
}

// findSingleAsterisk finds the index of a single '*' not part of '**' in s.
func findSingleAsterisk(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '*' {
			if i+1 < len(s) && s[i+1] == '*' {
				i++ // skip **
				continue
			}
			return i
		}
	}
	return -1
}
