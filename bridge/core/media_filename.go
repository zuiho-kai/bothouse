package core

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var (
	mediaTokenSepRe   = regexp.MustCompile(`[-_\s]+`)
	versionBanTokenRe = regexp.MustCompile(`^([A-Za-z0-9]+)版(.+)$`)
	asciiAlnumRe      = regexp.MustCompile(`[A-Za-z0-9]+`)
)

func isNoiseMediaToken(tok string) bool {
	switch strings.ToLower(strings.TrimSpace(tok)) {
	case "", "discord", "send", "低清", "高清", "超清", "原画", "2160p", "1440p", "1080p", "720p", "540p", "480p", "4k":
		return true
	}
	return false
}

func mediaLabelTokens(name string) []string {
	base := filepath.Base(name)
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	var out []string
	for _, tok := range mediaTokenSepRe.Split(stem, -1) {
		tok = strings.TrimSpace(tok)
		if tok == "" || isNoiseMediaToken(tok) {
			continue
		}
		out = append(out, tok)
	}
	return out
}

func formatVideoLabel(tokens []string, fallbackStem string) string {
	if len(tokens) == 0 {
		return strings.TrimSpace(fallbackStem)
	}
	parts := make([]string, 0, len(tokens))
	for _, tok := range tokens {
		if m := versionBanTokenRe.FindStringSubmatch(tok); len(m) == 3 {
			parts = append(parts, m[1]+"版·"+strings.TrimLeft(m[2], "·-_. "))
		} else {
			parts = append(parts, tok)
		}
	}
	return strings.Join(parts, "·")
}

// VideoAttachmentLabels builds one human-readable version label per video file name.
// When explicit labels are provided, non-empty entries override the derived label for that index.
// Otherwise, when multiple videos share a common prefix/suffix (e.g. project title and delivery tag),
// the shared parts are stripped so each label highlights its version difference (e.g. "A版·纯古琴").
func VideoAttachmentLabels(names, explicit []string) []string {
	if len(names) == 0 {
		return nil
	}
	toks := make([][]string, len(names))
	stems := make([]string, len(names))
	for i, n := range names {
		base := filepath.Base(n)
		stems[i] = strings.TrimSuffix(base, filepath.Ext(base))
		toks[i] = mediaLabelTokens(n)
	}
	if len(names) >= 2 {
		// Strip shared leading tokens while every item keeps at least one token.
		for {
			minLen := len(toks[0])
			for _, t := range toks[1:] {
				if len(t) < minLen {
					minLen = len(t)
				}
			}
			if minLen <= 1 {
				break
			}
			first := toks[0][0]
			same := true
			for _, t := range toks[1:] {
				if t[0] != first {
					same = false
					break
				}
			}
			if !same {
				break
			}
			for i := range toks {
				toks[i] = toks[i][1:]
			}
		}
		// Strip shared trailing tokens while every item keeps at least one token.
		for {
			minLen := len(toks[0])
			for _, t := range toks[1:] {
				if len(t) < minLen {
					minLen = len(t)
				}
			}
			if minLen <= 1 {
				break
			}
			last := toks[0][len(toks[0])-1]
			same := true
			for _, t := range toks[1:] {
				if t[len(t)-1] != last {
					same = false
					break
				}
			}
			if !same {
				break
			}
			for i := range toks {
				toks[i] = toks[i][:len(toks[i])-1]
			}
		}
	}
	labels := make([]string, len(names))
	for i := range names {
		if i < len(explicit) && strings.TrimSpace(explicit[i]) != "" {
			labels[i] = strings.TrimSpace(explicit[i])
			continue
		}
		labels[i] = formatVideoLabel(toks[i], stems[i])
	}
	return labels
}

func isSafeASCIIFileName(base string) bool {
	if base == "" {
		return false
	}
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	if stem == "" {
		return false
	}
	first := stem[0]
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || (first >= '0' && first <= '9')) {
		return false
	}
	hasAlnum := false
	for i := 0; i < len(base); i++ {
		c := base[i]
		if c > 127 {
			return false
		}
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.'
		if !ok {
			return false
		}
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			hasAlnum = true
		}
	}
	return hasAlnum
}

func cleanASCIIExt(ext string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(ext) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return "." + b.String()
}

// maxASCIIStemLen caps generated ASCII upload stems so Discord shows the full identifier cleanly.
// 来源：用户示例 1148_1_A_guqin.mp4 长度风格与 Discord 附件条可读宽度上限（约 48 字符）。
const maxASCIIStemLen = 48

// ASCIIFileName returns an ASCII-only filename safe for platforms like Discord that strip non-ASCII
// characters from uploaded filenames. Pure ASCII filenames are returned unchanged. Non-ASCII names
// are formatted as "<boardID>_<index>_<ascii-alnum-parts><ext>" (e.g. "1148_1_A_guqin.mp4", or
// "1148_1.mp4" when the stem has no ASCII letters/digits); when boardID and index are both 0 and no
// ASCII tokens exist, a short hash fallback ("file_<8hex><ext>") is used.
func ASCIIFileName(name string, boardID, index int) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == "/" {
		return ""
	}
	if isSafeASCIIFileName(base) {
		return base
	}
	ext := cleanASCIIExt(filepath.Ext(base))
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	runs := asciiAlnumRe.FindAllString(stem, -1)
	if boardID > 0 && len(runs) > 0 && runs[0] == strconv.Itoa(boardID) {
		runs = runs[1:]
	}
	parts := make([]string, 0, 3) // 来源：最多拼 任务号、序号、英文数字部分 三段
	if boardID > 0 {
		parts = append(parts, strconv.Itoa(boardID))
	}
	if index > 0 {
		parts = append(parts, strconv.Itoa(index))
	}
	if len(runs) > 0 {
		parts = append(parts, strings.Join(runs, "_"))
	}
	if len(parts) == 0 {
		sum := sha256.Sum256([]byte(base))
		parts = append(parts, "file_"+hex.EncodeToString(sum[:4])) // 来源：4 字节（8 位 hex）短摘要防重名兜底
	}
	slug := strings.Join(parts, "_")
	if len(slug) > maxASCIIStemLen {
		slug = strings.TrimRight(slug[:maxASCIIStemLen], "_-")
	}
	return slug + ext
}

func uniqueASCIIFileName(name string, used map[string]bool) string {
	if !used[name] {
		used[name] = true
		return name
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		cand := stem + "_" + strconv.Itoa(i) + ext
		if !used[cand] {
			used[cand] = true
			return cand
		}
	}
}

type preparedFileSend struct {
	file  FileAttachment
	label string // non-empty only for video files
}

// prepareFileSends prepares a batch of outbound files: each video gets a human-readable version
// label (to send right before the video) and an ASCII-safe upload filename (deduplicated within the
// batch). Non-video files pass through unchanged.
func prepareFileSends(files []FileAttachment, boardID int, explicitVideoLabels []string) []preparedFileSend {
	var videoNames []string
	for _, f := range files {
		if isVideoFile(f) {
			videoNames = append(videoNames, f.FileName)
		}
	}
	labels := VideoAttachmentLabels(videoNames, explicitVideoLabels)
	used := map[string]bool{}
	out := make([]preparedFileSend, len(files))
	vidSeq := 0
	for i, f := range files {
		if isVideoFile(f) {
			vidSeq++
			label := labels[vidSeq-1]
			f.FileName = uniqueASCIIFileName(ASCIIFileName(f.FileName, boardID, vidSeq), used)
			out[i] = preparedFileSend{file: f, label: label}
		} else {
			out[i] = preparedFileSend{file: f}
		}
	}
	return out
}
