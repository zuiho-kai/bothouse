package core

import (
	"strings"
	"testing"
)

func TestRemovedPlatformStartsAsFailingStub(t *testing.T) {
	p, err := CreatePlatform("dingtalk", nil)
	if err != nil {
		t.Fatalf("CreatePlatform(dingtalk) = %v, want a stub", err)
	}
	if p.Name() != "dingtalk" {
		t.Fatalf("Name = %q", p.Name())
	}
	if err := p.Start(nil); err == nil || !strings.Contains(err.Error(), "已从 bothouse 移除") {
		t.Fatalf("Start err = %v, want removed notice", err)
	}
}
