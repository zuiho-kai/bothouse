package acp

import (
	"encoding/json"
	"fmt"
	"io"
	"testing"
	"time"
)

func readCloseRequest(t *testing.T, r io.Reader) inputRPCRequest {
	t.Helper()
	type result struct {
		request inputRPCRequest
		err     error
	}
	read := make(chan result, 1)
	go func() {
		var v result
		v.err = json.NewDecoder(r).Decode(&v.request)
		read <- v
	}()
	select {
	case v := <-read:
		if v.err != nil {
			t.Fatal(v.err)
		}
		return v.request
	case <-time.After(time.Second):
		t.Fatal("session/close was not sent before process teardown")
		return inputRPCRequest{}
	}
}

func TestCloseSessionFlushesBeforeCancellation(t *testing.T) {
	s, w, r := newTestSession(t, nil)
	s.closeSupported = true
	done := make(chan error, 1)
	go func() { done <- s.Close() }()
	request := readCloseRequest(t, r)
	if request.Method != "session/close" || request.Params.SessionID != s.CurrentSessionID() {
		t.Fatalf("wrong close: %+v", request)
	}
	if s.ctx.Err() != nil {
		t.Fatal("process cancelled before durable close")
	}
	fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":{}}`+"\n", request.ID)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if s.ctx.Err() == nil {
		t.Fatal("process not reaped")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCloseSessionFailureIsReportedAndBounded(t *testing.T) {
	for _, timeout := range []bool{false, true} {
		t.Run(fmt.Sprint(timeout), func(t *testing.T) {
			s, w, r := newTestSession(t, nil)
			s.closeSupported = true
			done := make(chan error, 1)
			go func() { done <- s.Close() }()
			request := readCloseRequest(t, r)
			if !timeout {
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"flush failed"}}`+"\n", request.ID)
			}
			select {
			case err := <-done:
				if err == nil || s.Close() != err {
					t.Fatalf("lost close error: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("close was not bounded")
			}
			if s.ctx.Err() == nil {
				t.Fatal("failed close left process running")
			}
		})
	}
}

func TestCloseSessionCancelledParentDoesNotWaitForRPC(t *testing.T) {
	s, _, _ := newTestSession(t, nil)
	s.closeSupported = true
	s.cancel()
	done := make(chan error, 1)
	go func() { done <- s.Close() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled close attempted RPC")
	}
}
