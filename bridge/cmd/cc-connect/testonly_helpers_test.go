package main

import (
	"encoding/json"

	"github.com/chenhg5/cc-connect/core"
)

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

func decodeSendPayload(data []byte, req *core.SendRequest) error {
	return json.Unmarshal(data, req)
}
