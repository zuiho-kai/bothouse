package core

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"
)

var (
	pinyinOnce sync.Once
	pinyinMap  map[rune]string

	mediaTokenSepRe   = regexp.MustCompile(`[-_\s]+`)
	versionBanTokenRe = regexp.MustCompile(`^([A-Za-z0-9]+)版(.+)$`)
)

func loadPinyinMap() map[rune]string {
	pinyinOnce.Do(func() {
		m := make(map[rune]string, 7000) // 来源：gb2312PinyinTable 共 6763 个 GB2312 一二级汉字
		for _, line := range strings.Split(gb2312PinyinTable, "\n") {
			idx := strings.IndexByte(line, ':')
			if idx <= 0 {
				continue
			}
			py := line[:idx]
			for _, r := range line[idx+1:] {
				m[r] = py
			}
		}
		pinyinMap = m
	})
	return pinyinMap
}

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
// When multiple videos share a common prefix/suffix (e.g. project title and delivery tag),
// the shared parts are stripped so each label highlights its version difference (e.g. "A版·纯古琴").
func VideoAttachmentLabels(names []string) []string {
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

func transliterateToASCII(src string) string {
	lut := loadPinyinMap()
	// Turn "A版·纯古琴" / "A版纯古琴" into "A_纯古琴" so the ASCII filename reads like "1148_A_chunguqin".
	src = versionBanTokenRe.ReplaceAllString(strings.TrimSpace(src), "${1}_${2}")
	var b strings.Builder
	prevKind := 0 // 0=sep, 1=ascii, 2=cjk
	writeSep := func() {
		if b.Len() > 0 && prevKind != 0 {
			b.WriteByte('_')
			prevKind = 0
		}
	}
	for _, r := range src {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			if prevKind == 2 {
				b.WriteByte('_')
			}
			b.WriteRune(r)
			prevKind = 1
		case r == '_' || r == '-' || r == '.' || r == '·' || unicode.IsSpace(r) || unicode.IsPunct(r):
			writeSep()
		default:
			if py, ok := lut[r]; ok {
				if prevKind == 1 {
					b.WriteByte('_')
				}
				b.WriteString(py)
				prevKind = 2
			}
		}
	}
	return strings.Trim(b.String(), "_")
}

// maxASCIIStemLen caps generated ASCII upload stems so Discord shows the full identifier cleanly.
// 来源：用户示例 1148_A_guqin.mp4 长度风格与 Discord 附件条可读宽度上限（约 48 字符）。
const maxASCIIStemLen = 48

// ASCIIFileName returns an ASCII-only filename (letters, digits, underscore, hyphen, plus extension)
// safe for platforms like Discord that strip non-ASCII characters from uploaded filenames.
// Pure ASCII filenames are returned unchanged. When hint is non-empty (e.g. a video version label),
// non-ASCII filenames derive their readable slug from hint rather than the entire long title.
func ASCIIFileName(name, prefix, hint string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == "/" {
		return ""
	}
	if isSafeASCIIFileName(base) {
		return base
	}
	ext := cleanASCIIExt(filepath.Ext(base))
	source := strings.TrimSpace(hint)
	if source == "" {
		toks := mediaLabelTokens(base)
		if len(toks) > 0 {
			source = strings.Join(toks, "_")
		} else {
			source = strings.TrimSuffix(base, filepath.Ext(base))
		}
	}
	slug := transliterateToASCII(source)
	cleanPrefix := transliterateToASCII(prefix)
	if cleanPrefix != "" && slug != "" && !strings.HasPrefix(strings.ToLower(slug), strings.ToLower(cleanPrefix)+"_") && !strings.EqualFold(slug, cleanPrefix) {
		slug = cleanPrefix + "_" + slug
	} else if slug == "" {
		sum := sha256.Sum256([]byte(base))
		shortHash := hex.EncodeToString(sum[:4]) // 来源：4 字节（8 位 hex）短摘要防重名兜底
		if cleanPrefix != "" {
			slug = cleanPrefix + "_" + shortHash
		} else {
			slug = "file_" + shortHash
		}
	}
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
