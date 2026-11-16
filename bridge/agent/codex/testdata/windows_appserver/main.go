//go:build windows

// A native console app-server fixture: no real agent, credentials or network.
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "idle" {
		for {
			time.Sleep(time.Hour)
		}
	}
	console := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")
	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil || len(request.ID) == 0 {
			continue
		}
		var result any = map[string]any{}
		switch request.Method {
		case "thread/start", "thread/resume":
			result = map[string]any{"thread": map[string]string{"id": "fixture-thread"}}
		case "test/status":
			window, _, _ := console.Call()
			result = map[string]any{"consoleWindow": uint64(window)}
		case "test/echo":
			result = request.Params
		case "test/startChild":
			child := exec.Command(os.Args[0], "idle")
			child.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true}
			if err := child.Start(); err != nil {
				panic(err)
			}
			result = map[string]int{"pid": child.Process.Pid}
		}
		if err := encoder.Encode(map[string]any{"id": request.ID, "result": result}); err != nil {
			return
		}
	}
}
