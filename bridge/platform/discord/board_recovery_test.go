package discord

import (
	"errors"
	"testing"
)

func TestBoardNetworkErrorDoesNotDuplicatePinnedIndex(t *testing.T) {
	api := &stubBoardAPI{editErr: errors.New("temporary connection error")}
	id, err := upsertBoard(api, "channel", "existing", "title\nnew task index")
	if err == nil || id != "existing" || len(api.sends) != 0 {
		t.Fatalf("network error created a duplicate board: id=%s err=%v sends=%d", id, err, len(api.sends))
	}
}

func TestBoardPinFailureRetainsMessageForRetry(t *testing.T) {
	api := &stubBoardAPI{pinErr: errors.New("missing permission"), unpinned: true}
	id, err := upsertBoard(api, "channel", "", "title\nindex")
	if id != "new" || err == nil {
		t.Fatalf("pin failure not recoverable: %s %v", id, err)
	}
	api.pinErr = nil
	if _, err := upsertBoard(api, "channel", id, "title\nindex"); err != nil {
		t.Fatal(err)
	}
	// A retry edits the retained board; it does not pin it again (no re-pin churn).
	if len(api.sends) != 1 || len(api.pins) != 1 || api.pins[0] != "new" {
		t.Fatalf("retry must reuse the retained board without re-pinning: sends=%d pins=%v", len(api.sends), api.pins)
	}
}
