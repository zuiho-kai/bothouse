package config

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/BurntSushi/toml"
)

// Match a complete single-line string/bool assignment, including literal
// strings containing '#'. Keep spacing and the actual comment byte-for-byte.
var platformOptionAssignment = regexp.MustCompile(`^([^=]*=[ \t]*)("(?:[^"\\]|\\.)*"|'[^']*'|true|false)([ \t]*(?:#.*)?\r?)$`)

// patchPlatformOption patches the first platform of platformType in projectName
// in memory, using the same project/platform spans as patchProjectAgentOption.
// nil or an empty string removes a key; strings and booleans set a value. The
// caller holds configMu, validates the complete edit and writes once, so a
// multi-option update cannot leave a partially updated file.
func patchPlatformOption(raw, projectName, platformType, key string, value any) (string, error) {
	var cfg Config
	if err := toml.Unmarshal([]byte(raw), &cfg); err != nil {
		return "", fmt.Errorf("parse config: %w", err)
	}
	projectIdx := projectIndex(&cfg, projectName)
	if projectIdx < 0 {
		return "", fmt.Errorf("project %q not found in config", projectName)
	}
	platformIdx := -1
	for i, p := range cfg.Projects[projectIdx].Platforms {
		if p.Type == platformType {
			platformIdx = i
			break
		}
	}
	lines, hadTrailing := splitConfigLines(raw)
	spans := buildRawProjectSpans(lines)
	if platformIdx < 0 || projectIdx >= len(spans) || platformIdx >= len(spans[projectIdx].platforms) {
		return "", fmt.Errorf("platform %q in project %q not located in raw config", platformType, projectName)
	}
	span := spans[projectIdx].platforms[platformIdx]
	// splitConfigLines leaves CR on each CRLF line. Preserve existing endings
	// and use the platform header's ending for new lines.
	cr := ""
	if strings.HasSuffix(lines[span.start], "\r") {
		cr = "\r"
	}
	remove := value == nil || value == ""
	if span.optionsStart < 0 {
		if remove {
			return raw, nil
		}
		// Put the new table after the platform's own fields, not before type.
		insertAt := span.start + 1
		for insertAt <= span.end && !isAnyTableHeader(lines[insertAt]) {
			insertAt++
		}
		if insertAt == len(lines) && !hadTrailing && !strings.HasSuffix(lines[insertAt-1], cr) {
			lines[insertAt-1] += cr
		}
		lines = insertLines(lines, insertAt, []string{"[projects.platforms.options]" + cr})
		span = buildRawProjectSpans(lines)[projectIdx].platforms[platformIdx]
	}
	for i := span.optionsStart + 1; i <= span.optionsEnd; i++ {
		if matchTomlStringKey(lines[i], key) {
			assignment := platformOptionAssignment.FindStringSubmatch(lines[i])
			if assignment == nil {
				return "", fmt.Errorf("option %s is not a single-line string or boolean assignment", key)
			}
			if remove {
				lines = append(lines[:i], lines[i+1:]...)
			} else {
				lines[i] = assignment[1] + platformOptionValue(value) + assignment[3]
			}
			return joinPlatformOptionLines(lines, hadTrailing), nil
		}
	}
	if !remove {
		insertAt := span.optionsEnd + 1
		// Trailing comments/blank lines introduce the next table; leave them there.
		for insertAt > span.optionsStart+1 {
			line := strings.TrimSpace(lines[insertAt-1])
			if line != "" && !strings.HasPrefix(line, "#") {
				break
			}
			insertAt--
		}
		if insertAt == len(lines) && !hadTrailing && !strings.HasSuffix(lines[insertAt-1], cr) {
			lines[insertAt-1] += cr
		}
		lines = insertLines(lines, insertAt, []string{key + " = " + platformOptionValue(value) + cr})
	}
	return joinPlatformOptionLines(lines, hadTrailing), nil
}

func platformOptionValue(value any) string {
	if s, ok := value.(string); ok {
		return quoteTomlString(s)
	}
	return fmt.Sprint(value)
}

func joinPlatformOptionLines(lines []string, hadTrailing bool) string {
	if !hadTrailing && len(lines) > 0 {
		lines[len(lines)-1] = strings.TrimSuffix(lines[len(lines)-1], "\r")
	}
	raw := strings.Join(lines, "\n")
	if hadTrailing {
		raw += "\n"
	}
	return raw
}
