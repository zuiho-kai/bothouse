package core

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
)

// DSHUsageSource reads DSH session logs:
// <dsh home>/sessions/<cwd slug>/<sessionId>/session.v4.jsonl.zstd (the default
// compression) or session.v4.jsonl. Each assistant/message line carries
// data.usage for one model response. A subagent runs in its own session whose
// first line names parentSession; its usage is booked to the root session.
//
// The .zstd log is a run of zstd frames, one per append batch, so progress is
// kept as the byte offset of the last fully decoded frame boundary (where the
// decoded text also ends with a newline): earlier frames never change, and a
// frame still being written is left for the next import.
type DSHUsageSource struct {
	Homes []string // DSH_HOME of each DSH role (default ~/.dsh)

	mu      sync.Mutex
	parents map[string]string // <sessions dir>/<id> -> parentSession ("" for a root)
}

func (*DSHUsageSource) Name() string { return "dsh" }

var dshLogNames = []string{"session.v4.jsonl.zstd", "session.v4.jsonl"}

func (s *DSHUsageSource) Files() ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, h := range s.Homes {
		if h == "" || seen[h] {
			continue
		}
		seen[h] = true
		for _, name := range dshLogNames {
			m, err := filepath.Glob(filepath.Join(h, "sessions", "*", "*", name))
			if err != nil {
				return nil, err
			}
			out = append(out, m...)
		}
	}
	return out, nil
}

// SessionID returns the root session of the file: the directory name, or for a
// subagent the parentSession chain followed up to a session without a parent.
func (s *DSHUsageSource) SessionID(path string) string {
	dir := filepath.Dir(path)
	id := filepath.Base(dir)
	sessions := filepath.Dir(filepath.Dir(dir))
	visited := map[string]bool{}
	for !visited[id] {
		visited[id] = true
		parent, ok := s.parentOf(sessions, id, dir)
		if !ok || parent == "" {
			return id
		}
		id, dir = parent, ""
	}
	return id
}

// parentOf reads (once) the session header of id. dir is its directory when
// known, else it is looked up under sessions/*/<id>.
func (s *DSHUsageSource) parentOf(sessions, id, dir string) (string, bool) {
	key := filepath.Join(sessions, id)
	s.mu.Lock()
	p, ok := s.parents[key]
	s.mu.Unlock()
	if ok {
		return p, true
	}
	if dir == "" {
		m, _ := filepath.Glob(filepath.Join(sessions, "*", id))
		if len(m) == 0 {
			return "", false
		}
		dir = m[0]
	}
	var head []byte
	for _, name := range dshLogNames {
		if h, err := dshFirstLine(filepath.Join(dir, name)); err == nil && len(h) > 0 {
			head = h
			break
		}
	}
	var hdr struct {
		Type          string `json:"type"`
		ParentSession string `json:"parentSession"`
	}
	if head == nil || json.Unmarshal(head, &hdr) != nil || hdr.Type != "session" {
		return "", false // not written yet; asked again next import
	}
	s.mu.Lock()
	if s.parents == nil {
		s.parents = map[string]string{}
	}
	s.parents[key] = hdr.ParentSession
	s.mu.Unlock()
	return hdr.ParentSession, true
}

func (s *DSHUsageSource) ParseLine(line []byte, sid string, _ *UsageFileState) (UsageRecord, bool) {
	return parseDSHLine(line, sid)
}

// parseDSHLine keys records by the session that wrote them (own), so a
// subagent's message ids never collide with its parent's.
func parseDSHLine(line []byte, own string) (UsageRecord, bool) {
	var l struct {
		Type string `json:"type"`
		Time int64  `json:"time"`
		Data struct {
			Message struct {
				ID     string `json:"id"`
				Source struct {
					Model string `json:"model"`
				} `json:"source"`
			} `json:"message"`
			Usage *struct {
				Input      int64 `json:"inputTokens"`
				Output     int64 `json:"outputTokens"`
				CacheRead  int64 `json:"cacheReadTokens"`
				CacheWrite int64 `json:"cacheWriteTokens"`
			} `json:"usage"`
		} `json:"data"`
	}
	if json.Unmarshal(line, &l) != nil || l.Type != "assistant/message" || l.Data.Usage == nil ||
		l.Data.Message.ID == "" || l.Time == 0 {
		return UsageRecord{}, false
	}
	u := l.Data.Usage
	model := l.Data.Message.Source.Model
	if model == "" {
		model = "unknown"
	}
	// DSH inputTokens already excludes cacheReadTokens (real logs: totalTokens = input+cacheRead+output).
	return UsageRecord{Time: time.UnixMilli(l.Time).Local(), Model: model, Input: u.Input, Output: u.Output,
		CacheRead: u.CacheRead, CacheWrite: u.CacheWrite, Known: true,
		Key: "dsh:" + own + ":" + l.Data.Message.ID}, true
}

// dshOwnLines parses plain lines with the file's own session id in the key.
type dshOwnLines struct {
	*DSHUsageSource
	own string
}

func (d dshOwnLines) ParseLine(line []byte, _ string, _ *UsageFileState) (UsageRecord, bool) {
	return parseDSHLine(line, d.own)
}

// ReadUsage implements UsageFileReader.
func (s *DSHUsageSource) ReadUsage(path, sid string, st *UsageFileState) ([]UsageRecord, error) {
	own := filepath.Base(filepath.Dir(path))
	if !strings.HasSuffix(path, ".zstd") {
		return readUsageLines(path, dshOwnLines{s, own}, sid, st)
	}
	buf, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if int64(len(buf)) == st.Offset {
		return nil, nil
	}
	if !zstdFrameBoundary(buf, st.Offset) {
		// The file was rewritten (shorter, or the offset is no longer where a
		// frame starts): read it again from the start; record keys make that
		// idempotent.
		st.Offset = 0
	}
	return readDSHFrames(buf, st, own)
}

// zstdFrameBoundary reports whether off is where a frame of b starts (or its end).
func zstdFrameBoundary(b []byte, off int64) bool {
	if off > int64(len(b)) {
		return false
	}
	p := 0
	for int64(p) < off {
		n, _, err := zstdFrameLen(b[p:])
		if err != nil || n == 0 {
			return false
		}
		p += n
	}
	return int64(p) == off
}

// readDSHFrames decodes the complete frames after st.Offset. It stops, without
// error, at a frame still being written or a broken one; st.Offset only moves
// past frames whose decoded text ends a line.
func readDSHFrames(file []byte, st *UsageFileState, own string) ([]UsageRecord, error) {
	dec, err := dshDecoder()
	if err != nil {
		return nil, err
	}
	buf := file[st.Offset:]
	var out []UsageRecord
	var pending []byte
	done := 0 // bytes of buf already added to st.Offset
	for p := 0; p < len(buf); {
		n, skip, err := zstdFrameLen(buf[p:])
		if err != nil || n == 0 {
			return out, nil // last frame still being written, or broken: retried next import
		}
		if !skip {
			if pending, err = dec.DecodeAll(buf[p:p+n], pending); err != nil {
				return out, nil
			}
		}
		p += n
		if len(pending) > 0 && pending[len(pending)-1] != '\n' {
			continue // a line spans into the next frame
		}
		for _, line := range bytes.Split(pending, []byte{'\n'}) {
			if line = bytes.TrimSpace(line); len(line) == 0 {
				continue
			}
			if rec, ok := parseDSHLine(line, own); ok {
				out = append(out, rec)
			}
		}
		pending = pending[:0]
		st.Offset += int64(p - done)
		done = p
	}
	return out, nil
}

// dshFirstLine returns the first line of a DSH log, decoding only the frames it needs.
func dshFirstLine(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if !strings.HasSuffix(path, ".zstd") {
		line, err := bufio.NewReader(f).ReadBytes('\n')
		if err != nil {
			return nil, err // no complete first line yet
		}
		return bytes.TrimSpace(line), nil
	}
	dec, err := dshDecoder()
	if err != nil {
		return nil, err
	}
	b, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	var out []byte
	for p := 0; p < len(b); {
		n, skip, err := zstdFrameLen(b[p:])
		if err != nil || n == 0 {
			return nil, errZstdBadFrame
		}
		if !skip {
			if out, err = dec.DecodeAll(b[p:p+n], out); err != nil {
				return nil, err
			}
			if i := bytes.IndexByte(out, '\n'); i >= 0 {
				return out[:i], nil
			}
		}
		p += n
	}
	return nil, errZstdBadFrame
}

var (
	dshDecOnce sync.Once
	dshDec     *zstd.Decoder
	dshDecErr  error

	errZstdNotFrame = errors.New("zstd: no frame here")
	errZstdBadFrame = errors.New("zstd: broken frame")
)

func dshDecoder() (*zstd.Decoder, error) {
	dshDecOnce.Do(func() {
		// SPEC: klauspost zstd docs, DecodeAll-only use wants concurrency 1.
		dshDec, dshDecErr = zstd.NewReader(nil, zstd.WithDecoderConcurrency(1))
	})
	return dshDec, dshDecErr
}

// zstd frame layout constants, all from RFC 8878 section 3.1.
const (
	zstdMagic         = 0xFD2FB528 // SPEC: RFC 8878 3.1.1 Magic_Number
	zstdSkipMagicMask = 0xFFFFFFF0 // SPEC: RFC 8878 3.1.2 skippable magic 0x184D2A5?
	zstdSkipMagic     = 0x184D2A50 // SPEC: RFC 8878 3.1.2
	zstdBlockHdrLen   = 3          // SPEC: RFC 8878 3.1.1.2 Block_Header is 3 bytes
	zstdChecksumLen   = 4          // SPEC: RFC 8878 3.1.1 Content_Checksum is 4 bytes
	zstdBlockRLE      = 1          // SPEC: RFC 8878 3.1.1.2.2 Block_Type RLE_Block
	zstdBlockReserved = 3          // SPEC: RFC 8878 3.1.1.2.2 Block_Type Reserved
)

var (
	zstdDictIDLen = [4]int{0, 1, 2, 4} // SPEC: RFC 8878 3.1.1.1.1 DID_Field_Size by Dictionary_ID_Flag
	zstdFCSLen    = [4]int{0, 2, 4, 8} // SPEC: RFC 8878 3.1.1.1.1 FCS_Field_Size (flag 0: 1 if single segment)
)

// zstdFrameLen returns the length of the zstd frame at the start of b, 0 when
// b ends before the frame does, and skip for a skippable frame.
func zstdFrameLen(b []byte) (n int, skip bool, err error) {
	const u32 = 4 // SPEC: RFC 8878 3.1 magic and skippable Frame_Size are 4-byte little-endian
	if len(b) < u32 {
		return 0, false, nil
	}
	magic := binary.LittleEndian.Uint32(b)
	if magic&zstdSkipMagicMask == zstdSkipMagic {
		if len(b) < 2*u32 {
			return 0, true, nil
		}
		n := 2*u32 + int(binary.LittleEndian.Uint32(b[u32:]))
		if n > len(b) {
			return 0, true, nil
		}
		return n, true, nil
	}
	if magic != zstdMagic {
		return 0, false, errZstdNotFrame
	}
	q := u32
	if q >= len(b) {
		return 0, false, nil
	}
	fhd := b[q] // Frame_Header_Descriptor, RFC 8878 3.1.1.1.1
	q++
	single := int(fhd>>5) & 1 // SPEC: RFC 8878 bit 5 Single_Segment_Flag
	if single == 0 {
		q++ // Window_Descriptor
	}
	q += zstdDictIDLen[fhd&3]      // SPEC: RFC 8878 bits 0-1 Dictionary_ID_Flag
	if fcs := fhd >> 6; fcs == 0 { // SPEC: RFC 8878 bits 6-7 Frame_Content_Size_Flag
		q += single
	} else {
		q += zstdFCSLen[fcs]
	}
	for {
		if q+zstdBlockHdrLen > len(b) {
			return 0, false, nil
		}
		h := int(b[q]) | int(b[q+1])<<8 | int(b[q+2])<<16 // SPEC: RFC 8878 3-byte little-endian Block_Header
		q += zstdBlockHdrLen
		switch (h >> 1) & 3 { // SPEC: RFC 8878 bits 1-2 Block_Type
		case zstdBlockRLE: // one byte repeated Block_Size times
			q++
		case zstdBlockReserved:
			return 0, false, errZstdBadFrame
		default:
			q += h >> 3 // SPEC: RFC 8878 bits 3-23 Block_Size
		}
		if h&1 == 1 { // SPEC: RFC 8878 bit 0 Last_Block
			break
		}
	}
	if fhd>>2&1 == 1 { // SPEC: RFC 8878 bit 2 Content_Checksum_Flag
		q += zstdChecksumLen
	}
	if q > len(b) {
		return 0, false, nil
	}
	return q, false, nil
}

// DSHHomeFromOptions returns the DSH_HOME an agent's options set in env, else
// the one its launcher script exports (cmd is a shell wrapper such as
// `export DSH_HOME=/path`), else "".
func DSHHomeFromOptions(opts map[string]any) string {
	switch m := opts["env"].(type) {
	case map[string]string:
		if v := m["DSH_HOME"]; v != "" {
			return v
		}
	case map[string]any:
		if v, ok := m["DSH_HOME"].(string); ok && v != "" {
			return v
		}
	}
	cmd, _ := opts["cmd"].(string)
	if cmd == "" {
		cmd, _ = opts["command"].(string)
	}
	return dshHomeFromScript(cmd)
}

var dshHomeAssign = regexp.MustCompile(`(?m)^\s*(?:export\s+)?DSH_HOME=(?:"([^"]*)"|'([^']*)'|([^\s;#]+))`)

// dshHomeFromScript reads DSH_HOME from a small text launcher (a "#!" script);
// values built from other variables than $HOME are not resolved.
func dshHomeFromScript(path string) string {
	if path == "" || !filepath.IsAbs(expandUsageHome(path)) {
		return ""
	}
	path = expandUsageHome(path)
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	head := make([]byte, 2)
	_, err = io.ReadFull(f, head)
	f.Close()
	if err != nil || string(head) != "#!" { // a binary, not a launcher script
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	m := dshHomeAssign.FindSubmatch(b)
	if m == nil {
		return ""
	}
	v := string(m[1]) + string(m[2]) + string(m[3])
	v = strings.Replace(strings.Replace(v, "${HOME}", "~", 1), "$HOME", "~", 1)
	if strings.Contains(v, "$") {
		return ""
	}
	return expandUsageHome(v)
}

func expandUsageHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			return filepath.Join(h, p[1:])
		}
	}
	return p
}

// FindDSHSessionLog returns the log of session id under <home>/sessions/<cwd
// slug>/<id>/ ("" when there is none). Session ids are UUIDs, so the cwd slug
// is not needed to find it.
func FindDSHSessionLog(home, id string) string {
	if home == "" || id == "" || strings.ContainsAny(id, `/\*?[`) {
		return ""
	}
	for _, name := range dshLogNames {
		if m, _ := filepath.Glob(filepath.Join(home, "sessions", "*", id, name)); len(m) > 0 {
			return m[0]
		}
	}
	return ""
}

// ReadDSHLog returns the text of a DSH session log: a plain .jsonl as is, a
// .zstd one decoded frame by frame (one frame per append batch). A last frame
// still being written, or a broken one, ends the text without an error.
func ReadDSHLog(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err != nil || !strings.HasSuffix(path, ".zstd") {
		return b, err
	}
	dec, err := dshDecoder()
	if err != nil {
		return nil, err
	}
	var out []byte
	for p := 0; p < len(b); {
		n, skip, err := zstdFrameLen(b[p:])
		if err != nil || n == 0 {
			break
		}
		if !skip {
			next, err := dec.DecodeAll(b[p:p+n], out)
			if err != nil {
				break
			}
			out = next
		}
		p += n
	}
	return out, nil
}
