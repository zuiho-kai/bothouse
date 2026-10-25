package core

import (
	"strings"
	"testing"
)

// Source: ~/im-bridge/bin/ws-handoff has_ref_impl/multi_editor/has_base; the Go
// task card must enforce the same delegation contract as the lead's handoff.
func TestAssignMemberRequiresRef(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangChinese, nil)
	req := func(member, title, ref, base string) TaskMemberAssignment {
		return TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, BatchID: "A", MemberID: member, Name: member, Title: title, Ref: ref, Base: base}
	}
	for _, bad := range []TaskMemberAssignment{
		req("w0", "Work", "", ""),
		req("w0", "Work", "看看现有实现", ""),
		req("w0", "Work", "14:30 之前", ""),
	} {
		if _, err := p.AssignMember(bad); err == nil || err.Error() != errAssignMissingRef {
			t.Fatalf("ref %q: got %v, want %q", bad.Ref, err, errAssignMissingRef)
		}
	}
	if len(p.Tasks("", 10)) != 0 {
		t.Fatal("rejected assignment opened a card")
	}
	for i, good := range []TaskMemberAssignment{
		req("w1", "写文案", "无（新建）", ""),
		req("w2", "Work", "bridge/core/task_members.go:35（照它的校验）", ""),
		req("w3", "Work", "~/im-bridge/bin/ws-handoff:68", ""),
	} {
		if _, err := p.AssignMember(good); err != nil {
			t.Fatalf("case %d ref %q rejected: %v", i, good.Ref, err)
		}
	}
	if _, err := p.AssignMember(req("w4", "多人改 任务卡", "core/task_members.go:35", "")); err == nil || err.Error() != errAssignMissingBase {
		t.Fatalf("shared-file assignment without base: %v", err)
	}
	if _, err := p.AssignMember(req("w4", "Work", "core/task_members.go:35 共改文件", "")); err == nil || err.Error() != errAssignMissingBase {
		t.Fatalf("shared-file ref without base: %v", err)
	}
	if _, err := p.AssignMember(req("w4", "多人改 任务卡", "core/task_members.go:35", "a b")); err == nil || strings.Contains(err.Error(), "底分支") {
		t.Fatalf("base with spaces: %v", err)
	}
	if _, err := p.AssignMember(req("w4", "多人改 任务卡", "core/task_members.go:35", "feat/approvals-card")); err != nil {
		t.Fatal(err)
	}
	tasks := p.Tasks("", 10)
	if len(tasks) != 1 || len(tasks[0].Members) != 4 {
		t.Fatalf("unexpected cards: %+v", tasks)
	}
}
