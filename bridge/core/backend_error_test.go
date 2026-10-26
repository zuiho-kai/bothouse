package core

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestBackendUnavailableText(t *testing.T) {
	reset := 2 * time.Hour
	for _, tc := range []struct {
		name string
		err  *BackendUnavailableError
		want []string
	}{
		{"quota with reset", &BackendUnavailableError{Provider: "Cursor", Kind: BackendErrorQuota, UsedPercent: 100, ResetAfter: reset}, []string{"Cursor 额度已用完", "2小时"}},
		{"quota without reset", &BackendUnavailableError{Provider: "Cursor", Kind: BackendErrorQuota, UsedPercent: 100}, []string{"Cursor 额度已用完"}},
		{"login", &BackendUnavailableError{Provider: "Cursor", Kind: BackendErrorAuth, UsedPercent: -1}, []string{"Cursor 登录已失效"}},
		{"plan", &BackendUnavailableError{Provider: "Cursor", Kind: BackendErrorPlan, Detail: "Upgrade your plan to continue", UsedPercent: -1}, []string{"套餐或付款方式不可用", "Upgrade your plan"}},
		{"internal with quota left", &BackendUnavailableError{Provider: "Cursor", Kind: BackendErrorInternal, Detail: "v: WritableIterable is closed", UsedPercent: 40}, []string{"Cursor 后端不可用", "v: WritableIterable is closed", "额度仍剩 60%"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msg, ok := BackendUnavailableText(fmt.Errorf("relay: %w", tc.err), LangChinese)
			if !ok {
				t.Fatal("typed error not recognized")
			}
			for _, want := range tc.want {
				if !strings.Contains(msg, want) {
					t.Fatalf("message = %q, missing %q", msg, want)
				}
			}
		})
	}
	if _, ok := BackendUnavailableText(errors.New("plain"), LangChinese); ok {
		t.Fatal("plain error treated as backend failure")
	}
}

func TestBackendUnavailableTextAllLanguages(t *testing.T) {
	for _, lang := range []Language{LangEnglish, LangChinese, LangTraditionalChinese, LangJapanese, LangSpanish} {
		msg, ok := BackendUnavailableText(&BackendUnavailableError{
			Provider:    "Cursor",
			Kind:        BackendErrorQuota,
			UsedPercent: 100,
			ResetAfter:  time.Hour,
		}, lang)
		if !ok || msg == "" || strings.Contains(msg, "%!") {
			t.Errorf("%s: message = %q, ok=%v", lang, msg, ok)
		}
	}
}
