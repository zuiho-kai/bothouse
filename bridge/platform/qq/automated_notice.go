package qq

import "strings"

// automatedMonitorNotice recognises the structured service-monitor notices that
// QQ relay bots post as ordinary user messages (OneBot exposes no bot flag for
// them). The match is deliberately narrow: a bracketed monitor verdict plus its
// machine-generated result fields, or the one-line start notice. A person using
// similar words in conversation does not match.
func automatedMonitorNotice(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	lines := strings.Split(trimmed, "\n")
	first := strings.TrimSpace(lines[0])
	if strings.HasPrefix(first, "开始检测：") {
		return len(lines) == 1 && strings.TrimSpace(strings.TrimPrefix(first, "开始检测：")) != ""
	}
	if !strings.HasPrefix(first, "[") {
		return false
	}
	end := strings.Index(first, "]")
	if end <= 1 {
		return false
	}
	label := first[1:end]
	switch {
	case strings.Contains(label, "检测完成"):
		return strings.Contains(trimmed, "Ciallo：") && strings.Contains(trimmed, "视觉：")
	case strings.Contains(label, "视觉检测"):
		return strings.Contains(trimmed, "视觉检测通过") || strings.Contains(trimmed, "视觉检测未通过")
	case strings.Contains(label, "分组恢复正常") || strings.Contains(label, "分组降智"):
		return strings.Contains(trimmed, "分组名：") && strings.Contains(trimmed, "检测时间：")
	case label == "状态列表":
		return strings.Contains(trimmed, "分组：") && strings.Contains(trimmed, "状态：")
	case label == "模型列表":
		return strings.Contains(trimmed, "分组：") && strings.Contains(trimmed, "模型：")
	case label == "运行失败":
		return strings.Contains(trimmed, "/modellist")
	case label == "正常" || label == "降智":
		return strings.Contains(first, "Ciallo 检测")
	}
	return false
}
