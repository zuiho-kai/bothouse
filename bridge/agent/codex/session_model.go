package codex

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"strings"
)

// rolloutModel reads runtime metadata, rather than guessing the CLI's implicit
// default from its configuration or the first entry of the model catalog.
func (cs *codexSession) rolloutModel() string {
	home, err := resolveCodexHome(cs.extraEnv)
	if err != nil {
		return ""
	}
	return readSessionModel(home, cs.CurrentSessionID())
}

// CurrentLocalSessionModel is the read-only fallback for a CLI query running
// inside Codex when the sandbox denies access to the bridge's IPC socket.
// CODEX_THREAD_ID is supplied by Codex to its tools; never use the newest file
// in CODEX_HOME, which may belong to another concurrently running agent.
func CurrentLocalSessionModel() string {
	home, err := resolveCodexHome(nil)
	if err != nil {
		return ""
	}
	return readSessionModel(home, os.Getenv("CODEX_THREAD_ID"))
}

func readSessionModel(home, id string) string {
	if strings.TrimSpace(id) == "" {
		return ""
	}
	f, err := os.Open(findSessionFileInCodexHome(home, id))
	if err != nil {
		return ""
	}
	defer f.Close()
	reader := bufio.NewReader(f)
	header, err := readModelMetadataLine(reader)
	var meta struct {
		Type    string `json:"type"`
		Payload struct {
			ID string `json:"id"`
		} `json:"payload"`
	}
	if err != nil || json.Unmarshal(header, &meta) != nil || meta.Type != "session_meta" || meta.Payload.ID != id {
		return ""
	}
	// Most queries only need the last MiB. Fall back to a bounded-memory scan
	// when large tool output has pushed the most recent turn_context out of it.
	info, err := f.Stat()
	if err != nil {
		return ""
	}
	if info.Size() > codexRolloutTailBytes {
		if _, err := f.Seek(info.Size()-codexRolloutTailBytes, io.SeekStart); err != nil {
			return ""
		}
		reader.Reset(f)
		_, _ = readModelMetadataLine(reader) // discard the partial first line
		if model := scanRolloutModel(reader); model != "" {
			return model
		}
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return ""
	}
	reader.Reset(f)
	return scanRolloutModel(reader)
}

func scanRolloutModel(reader *bufio.Reader) string {
	model := ""
	for {
		line, err := readModelMetadataLine(reader)
		if err != nil {
			return model
		} // ignore a partially written final record
		var record struct {
			Type    string `json:"type"`
			Payload struct {
				Model string `json:"model"`
			} `json:"payload"`
		}
		if json.Unmarshal(line, &record) == nil && record.Type == "turn_context" && strings.TrimSpace(record.Payload.Model) != "" {
			model = strings.TrimSpace(record.Payload.Model)
		}
	}
}

// Skip oversized tool/transcript records without stopping the scan or keeping
// their contents in memory. Only small metadata records are decoded.
func readModelMetadataLine(reader *bufio.Reader) ([]byte, error) {
	const maxLine = 2 << 20
	var line []byte
	oversized := false
	for {
		part, err := reader.ReadSlice('\n')
		if !oversized {
			if len(line)+len(part) > maxLine {
				line = nil
				oversized = true
			} else {
				line = append(line, part...)
			}
		}
		if err != bufio.ErrBufferFull {
			return line, err
		}
	}
}
