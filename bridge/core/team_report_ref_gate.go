package core

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// A task done after a reference (copy a clip, an article's form, a UI, a picture, a reference
// implementation) carries a 「## 原件」 section in its handoff: what the original is made of, what
// we use, and the evidence (#1897). Its deliverable reaches the user only after a judge who did
// not read the handoff compared it with the original side by side (the lead's ws-pass with the
// attachments). So the bridge does not post the attachments of such a report itself — not on a
// text-only release (ws-pass --verdict), not on the unchecked post after leadAcceptTimeout.
// User 11-23 「根因……你就要思考为什么会这样，怎么规避」「别的场景也是一样」: four versions of a
// copied clip went to the user as attachments of a released or timed-out report, never judged
// against the original.

// refSectionRe is the 「原件」 heading the handoff check requires for a reference task.
var refSectionRe = regexp.MustCompile(`(?m)^#{1,4}[ \t]*原件`)

// refWithheldNote is told in the chat channel when a reference task's attachments were withheld.
const refWithheldNote = "（这件是照原件做的：成品 %d 个还没过原件对照，先不贴；主角色对照原件判过后再发）"

// refGated: item's handoff notes carry a 「原件」 section.
func refGated(item *teamTaskBoardItem) bool {
	if item == nil {
		return false
	}
	path := strings.TrimSpace(item.Where)
	if path == "" || strings.Contains(path, "://") {
		return false
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return false
		}
		path = filepath.Join(home, path[2:])
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return refSectionRe.Match(b)
}

// refLeadPrompt tells the lead how a reference task's deliverable goes out.
func refLeadPrompt(hid int) string {
	return fmt.Sprintf("\n这件活的交接有「原件」节（照参考做的活）：附件不会随 --verdict 放行或超时贴出。"+
		"成品要发给用户，只能走 ws-pass --id %d <附件路径…> \"给用户的话\" --verdict \"…\"：它让没看过交接的判定者拿原件和成品并排判像不像，判不像就拦。"+
		"判不像用 ws-forward 打回；只放行文字照旧 --verdict。\n", hid)
}
