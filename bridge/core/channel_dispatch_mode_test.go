package core

import (
	"context"
	"errors"
	"testing"
	"time"
)

type modePlatform struct {
	stubPlatformEngine
	mode     string
	explicit bool
	fail     bool
	wait     bool
}

func (p *modePlatform) ChannelDispatchMode(ctx context.Context, key string) (string, bool, error) {
	if p.wait {
		<-ctx.Done()
		return "", false, ctx.Err()
	}
	if p.fail {
		return "", false, errors.New("unavailable")
	}
	return p.mode, p.explicit, nil
}
func TestChannelDispatchModePriorityAndTimeout(t *testing.T) {
	e := &Engine{}
	e.SetDispatchMode(DispatchSolo)
	p := &modePlatform{mode: DispatchTeam, explicit: true}
	if got := e.channelDispatchMode(p, "room1"); got != DispatchTeam {
		t.Fatal(got)
	}
	p.mode = DispatchMixed
	if got := e.channelDispatchMode(p, "room2"); got != DispatchMixed {
		t.Fatal(got)
	}
	p.explicit = false
	if got := e.channelDispatchMode(p, "room2"); got != DispatchSolo {
		t.Fatal(got)
	}
	p.fail = true
	if got := e.channelDispatchMode(p, "room2"); got != DispatchSolo {
		t.Fatal(got)
	}
	p.wait = true
	start := time.Now()
	if got := e.channelDispatchMode(p, "room2"); got != DispatchSolo {
		t.Fatal(got)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("lookup stalled delivery")
	}
	if got := e.channelDispatchMode(&stubPlatformEngine{}, "discord:room"); got != DispatchSolo {
		t.Fatal(got)
	}
}
