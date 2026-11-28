package feishu

import (
	"context"
	"errors"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.PreviewCleaner = (*Platform)(nil)

func TestDeletePreviewMessageKeepsInteractiveCard(t *testing.T) {
	p := &Platform{useInteractiveCard: true}
	if err := p.DeletePreviewMessage(context.Background(), &feishuPreviewHandle{messageID: "om_test"}); !errors.Is(err, core.ErrNotSupported) {
		t.Fatalf("DeletePreviewMessage() error = %v, want ErrNotSupported", err)
	}
}

var _ core.PreviewFinishPreference = (*Platform)(nil)
