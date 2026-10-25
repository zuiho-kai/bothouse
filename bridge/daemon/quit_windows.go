package daemon

import "os"

func StopCurrentService() error {
	if os.Getenv("CC_SUPERVISED") != "1" {
		return nil
	}
	return stopWindowsTask()
}
