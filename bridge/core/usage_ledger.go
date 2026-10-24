package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// TokenPrice is an estimate per million tokens, in the configured currency.
// Input excludes cache reads and writes; reasoning is included in output.
type TokenPrice struct {
	Input      float64 `json:"input" toml:"input"`
	Output     float64 `json:"output" toml:"output"`
	CacheRead  float64 `json:"cache_read" toml:"cache_read"`
	CacheWrite float64 `json:"cache_write" toml:"cache_write"`
}

// Validate rejects prices that cannot be used for finite, nonnegative estimates.
func (p TokenPrice) Validate() error {
	for _, v := range []float64{p.Input, p.Output, p.CacheRead, p.CacheWrite} {
		if v < 0 || math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("token prices must be finite and nonnegative")
		}
	}
	return nil
}

type UsageRecord struct {
	Time       time.Time `json:"time"`
	Role       string    `json:"role"`
	Model      string    `json:"model"`
	Input      int64     `json:"input_tokens"`
	Output     int64     `json:"output_tokens"`
	CacheRead  int64     `json:"cache_read_tokens"`
	CacheWrite int64     `json:"cache_write_tokens"`
	Known      bool      `json:"usage_known"`
}
type UsageAggregate struct {
	Date          string   `json:"date,omitempty"`
	Hour          int      `json:"hour"`
	Role          string   `json:"role,omitempty"`
	Model         string   `json:"model,omitempty"`
	Input         int64    `json:"input_tokens"`
	Output        int64    `json:"output_tokens"`
	CacheRead     int64    `json:"cache_read_tokens"`
	CacheWrite    int64    `json:"cache_write_tokens"`
	Total         int64    `json:"total_tokens"`
	Responses     int64    `json:"responses"`
	Unknown       int64    `json:"unknown_usage_responses"`
	EstimatedCost *float64 `json:"estimated_cost,omitempty"`
	Unpriced      int64    `json:"unpriced_responses"`
}
type usageDay struct {
	Records []UsageRecord    `json:"records"`
	Buckets []UsageAggregate `json:"buckets"`
}
type UsageLedger struct {
	mu     sync.Mutex // serializes writers only; readers rely on atomic rename
	dir    string
	prices map[string]TokenPrice

	startOnce sync.Once
	queue     chan usageJob
}

// usageJob is one record to persist, or (flushed != nil) a marker that is
// closed once every record queued before it has been written.
type usageJob struct {
	r       UsageRecord
	flushed chan struct{}
}

// usageQueueSize bounds records waiting for the writer goroutine. Estimate
// sized so replies never wait on disk: each finished turn enqueues one record,
// and even a few dozen concurrent sessions finishing together stay far below
// 256. If it does fill, Enqueue writes that record synchronously, so none is lost.
const usageQueueSize = 256

func NewUsageLedger(dataDir string, prices map[string]TokenPrice) *UsageLedger {
	p := make(map[string]TokenPrice, len(prices))
	for k, v := range prices {
		p[k] = v
	}
	return &UsageLedger{dir: filepath.Join(dataDir, "usage"), prices: p, queue: make(chan usageJob, usageQueueSize)}
}

func (l *UsageLedger) start() {
	l.startOnce.Do(func() { go l.run() })
}

func (l *UsageLedger) run() {
	for job := range l.queue {
		if job.flushed != nil {
			close(job.flushed)
			continue
		}
		l.persist(job.r)
	}
}

func (l *UsageLedger) persist(r UsageRecord) {
	if err := l.Record(r); err != nil {
		slog.Error("persist turn usage", "role", r.Role, "error", err)
	}
}

// Enqueue hands a record to the background writer without blocking. When the
// queue is full the record is written synchronously instead, so none is lost.
func (l *UsageLedger) Enqueue(r UsageRecord) {
	l.start()
	select {
	case l.queue <- usageJob{r: r}:
	default:
		l.persist(r)
	}
}

// Flush blocks until every record enqueued before the call is written.
func (l *UsageLedger) Flush() {
	l.start()
	done := make(chan struct{})
	l.queue <- usageJob{flushed: done}
	<-done
}
func (l *UsageLedger) readDay(date string) (usageDay, error) {
	var day usageDay
	b, err := os.ReadFile(filepath.Join(l.dir, date+".json"))
	if os.IsNotExist(err) {
		return day, nil
	}
	if err != nil {
		return day, err
	}
	err = json.Unmarshal(b, &day)
	return day, err
}
// Record writes synchronously; reply paths use Enqueue instead.
func (l *UsageLedger) Record(r UsageRecord) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if r.Time.IsZero() {
		r.Time = time.Now()
	}
	if r.Input < 0 || r.Output < 0 || r.CacheRead < 0 || r.CacheWrite < 0 {
		return fmt.Errorf("negative token usage")
	}
	date := r.Time.Format("2006-01-02")
	day, err := l.readDay(date)
	if err != nil {
		return fmt.Errorf("read usage: %w", err)
	}
	day.Records = append(day.Records, r)
	day.Buckets = l.aggregate(day.Records, "buckets")
	if err = os.MkdirAll(l.dir, 0700); err != nil {
		return err
	}
	b, err := json.Marshal(day)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(l.dir, ".usage-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, filepath.Join(l.dir, date+".json"))
}
func (l *UsageLedger) aggregate(records []UsageRecord, group string) []UsageAggregate {
	buckets := map[string]*UsageAggregate{}
	for _, r := range records {
		b := UsageAggregate{Hour: -1}
		switch group {
		case "daily":
			b.Date = r.Time.Format("2006-01-02")
		case "hourly":
			b.Hour = r.Time.Hour()
		case "roles":
			b.Role = r.Role
		case "models":
			b.Model = r.Model
		default:
			b.Date = r.Time.Format("2006-01-02")
			b.Hour = r.Time.Hour()
			b.Role = r.Role
			b.Model = r.Model
		}
		keyBytes, _ := json.Marshal(b)
		key := string(keyBytes)
		dst := buckets[key]
		if dst == nil {
			dst = &b
			buckets[key] = dst
		}
		dst.Input += r.Input
		dst.Output += r.Output
		dst.CacheRead += r.CacheRead
		dst.CacheWrite += r.CacheWrite
		dst.Total += r.Input + r.Output + r.CacheRead + r.CacheWrite
		dst.Responses++
		if !r.Known {
			dst.Unknown++
		}
		if price, ok := l.prices[r.Model]; ok && r.Known {
			cost := (float64(r.Input)*price.Input + float64(r.Output)*price.Output + float64(r.CacheRead)*price.CacheRead + float64(r.CacheWrite)*price.CacheWrite) / 1e6
			if dst.EstimatedCost == nil {
				dst.EstimatedCost = new(float64)
			}
			*dst.EstimatedCost += cost
		} else {
			dst.Unpriced++
		}
	}
	keys := make([]string, 0, len(buckets))
	for k := range buckets {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]UsageAggregate, 0, len(keys))
	for _, k := range keys {
		out = append(out, *buckets[k])
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.Hour != b.Hour {
			return a.Hour < b.Hour
		}
		if a.Role != b.Role {
			return a.Role < b.Role
		}
		return a.Model < b.Model
	})
	return out
}

// Query uses local calendar dates, inclusively. Missing dates have no buckets.
// It takes no lock: Record replaces day files by rename, so a read sees either
// the old or the new file, and queries never hold up writes.
func (l *UsageLedger) Query(from, to time.Time, group, role, model string) ([]UsageAggregate, error) {
	records := []UsageRecord{}
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		day, err := l.readDay(d.Format("2006-01-02"))
		if err != nil {
			return nil, err
		}
		for _, r := range day.Records {
			if (role == "" || role == r.Role) && (model == "" || model == r.Model) {
				records = append(records, r)
			}
		}
	}
	return l.aggregate(records, group), nil
}
func (e *Engine) recordUsage(event Event, session AgentSession) {
	if e.usageLedger == nil || !event.Done {
		return
	}
	model := replyFooterModel(session, e.agent)
	if model == "" {
		model = "unknown"
	}
	r := UsageRecord{Time: time.Now(), Role: e.name, Model: model, Input: int64(event.InputTokens), Output: int64(event.OutputTokens), CacheRead: int64(event.CacheReadInputTokens), CacheWrite: int64(event.CacheCreationInputTokens), Known: event.UsageKnown}
	e.usageLedger.Enqueue(r)
}
func (e *Engine) SetUsageLedger(l *UsageLedger) { e.usageLedger = l }
