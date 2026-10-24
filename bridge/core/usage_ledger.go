package core

import (
	"encoding/json"
	"fmt"
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
	// Key identifies one model response in its source log (for example
	// "claudecode:<message.id>"). Upsert replaces a record with the same key,
	// so re-reading a log never counts a response twice.
	Key string `json:"key,omitempty"`
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
}

func NewUsageLedger(dataDir string, prices map[string]TokenPrice) *UsageLedger {
	p := make(map[string]TokenPrice, len(prices))
	for k, v := range prices {
		p[k] = v
	}
	return &UsageLedger{dir: filepath.Join(dataDir, "usage"), prices: p}
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
// Record appends one record synchronously.
func (l *UsageLedger) Record(r UsageRecord) error {
	if r.Time.IsZero() {
		r.Time = time.Now()
	}
	return l.Upsert([]UsageRecord{r})
}

// Upsert writes records grouped by local date. A record whose Key matches an
// existing record of that day replaces it, keeping the larger value of each
// token field (a log can repeat one response with partial then final usage).
// Records without a Key are always appended.
func (l *UsageLedger) Upsert(records []UsageRecord) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	byDate := map[string][]UsageRecord{}
	var dates []string
	for _, r := range records {
		if r.Time.IsZero() {
			return fmt.Errorf("usage record without time")
		}
		if r.Input < 0 || r.Output < 0 || r.CacheRead < 0 || r.CacheWrite < 0 {
			return fmt.Errorf("negative token usage")
		}
		date := r.Time.Format("2006-01-02")
		if _, ok := byDate[date]; !ok {
			dates = append(dates, date)
		}
		byDate[date] = append(byDate[date], r)
	}
	for _, date := range dates {
		day, err := l.readDay(date)
		if err != nil {
			return fmt.Errorf("read usage: %w", err)
		}
		index := map[string]int{}
		for i, r := range day.Records {
			if r.Key != "" {
				index[r.Key] = i
			}
		}
		for _, r := range byDate[date] {
			if i, ok := index[r.Key]; ok && r.Key != "" {
				old := day.Records[i]
				r.Input = max(r.Input, old.Input)
				r.Output = max(r.Output, old.Output)
				r.CacheRead = max(r.CacheRead, old.CacheRead)
				r.CacheWrite = max(r.CacheWrite, old.CacheWrite)
				r.Known = r.Known || old.Known
				day.Records[i] = r
				continue
			}
			if r.Key != "" {
				index[r.Key] = len(day.Records)
			}
			day.Records = append(day.Records, r)
		}
		day.Buckets = l.aggregate(day.Records, "buckets")
		if err := l.writeDay(date, day); err != nil {
			return err
		}
	}
	return nil
}

func (l *UsageLedger) writeDay(date string, day usageDay) error {
	if err := os.MkdirAll(l.dir, 0700); err != nil {
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
