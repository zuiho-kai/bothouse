package core

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

// A small projection of the public journal. Never copy prompts, summaries,
// run tokens or events into the shared team heartbeat.
type teamTaskLink struct {
	ID         string    `json:"id"`
	SessionKey string    `json:"session_key"`
	Title      string    `json:"title"`
	URL        string    `json:"url"`
	State      TaskState `json:"state"`
	UpdatedAt  time.Time `json:"updated_at"`
	// Progress: the card's latest public progress line; ThreadURL: its task thread (the
	// chat's pinned task table says what the item is doing and links there).
	Progress  string `json:"progress,omitempty"`
	ThreadURL string `json:"thread_url,omitempty"`
	// Members carries only public assignment rows (no summaries or tokens)
	// so the lead's board can show dispatched teammates.
	Members []teamTaskMember `json:"members,omitempty"`
}

type teamTaskMember struct {
	ReporterProject string    `json:"reporter_project,omitempty"`
	ParentID        string    `json:"parent_id,omitempty"`
	Name            string    `json:"name"`
	Title           string    `json:"title,omitempty"`
	Status          string    `json:"status"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func teamTaskMembers(ms []TaskMember) []teamTaskMember {
	var out []teamTaskMember
	for _, m := range ms {
		out = append(out, teamTaskMember{ReporterProject: m.ReporterProject, ParentID: m.ParentID, Name: m.Name, Title: m.Title, Status: m.Status, UpdatedAt: m.UpdatedAt})
	}
	return out
}

func listedTaskState(state TaskState) bool {
	return state == TaskStateReceived || state == TaskStateInProgress || state == TaskStateWaitingUser
}

// Caller holds r.mu and p.mu, in that order, just like Report/finish.
func (p *PublicProgress) indexRun(r *publicRun) {
	if listedTaskState(r.record.Task.State) {
		p.listed[r.record.Task.ID] = r
	} else {
		delete(p.listed, r.record.Task.ID)
	}
}

func (p *PublicProgress) taskLinks() []teamTaskLink {
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.listed))
	for _, r := range p.listed {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	var links []teamTaskLink
	for _, r := range runs {
		r.mu.Lock()
		t := r.record.Task
		// A link is useful only once the platform has returned a real message.
		if listedTaskState(t.State) && t.MessageID != "" && boardTaskURL(t.CardURL) {
			links = append(links, teamTaskLink{ID: t.ID, SessionKey: t.SessionKey, Title: t.Title, URL: t.CardURL, State: t.State, UpdatedAt: t.UpdatedAt, Progress: t.LatestProgress, ThreadURL: taskThreadURL(t.CardURL, t.ThreadID), Members: teamTaskMembers(t.Members)})
		}
		r.mu.Unlock()
	}
	sort.Slice(links, func(i, j int) bool { return links[i].ID < links[j].ID })
	return links
}

// taskThreadURL: the Discord link of the card's thread (https://discord.com/channels/<guild>/<thread>),
// "" without a thread or for a card link of another form.
func taskThreadURL(cardURL, threadID string) string {
	const head = "https://discord.com/channels/"
	if threadID == "" || !strings.HasPrefix(cardURL, head) {
		return ""
	}
	guild, _, ok := strings.Cut(strings.TrimPrefix(cardURL, head), "/")
	if !ok || guild == "" {
		return ""
	}
	return head + guild + "/" + threadID
}

func safeTaskURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil &&
		!strings.ContainsAny(raw, " \t\r\n()<>\\") && len(raw) <= 240
}

// boardTaskURL accepts a task for the board: a safe link, or no link at all.
// cloud_web (Channels / DSH) edits the card in the room but has no message
// permalink, so its CardURL stays empty; requiring https dropped every one of
// its tasks from the board. Such tasks are listed without a link.
func boardTaskURL(raw string) bool {
	return raw == "" || safeTaskURL(raw)
}

// Keep task/role names on one line without permitting extra links or mentions.
func taskIndexLabel(text string, limit int) string {
	text = strings.Join(strings.Fields(text), " ")
	text = strings.NewReplacer("[", "［", "]", "］", "(", "（", ")", "）", "@", "＠", "<", "‹", ">", "›", "*", "＊", "_", "＿", "`", "＇", "\\", "＼").Replace(text)
	runes := []rune(text)
	if len(runes) > limit {
		text = string(runes[:limit]) + "…"
	}
	return text
}

func renderTeamBoardWithTasks(files []teamFile, chat string, lang Language) string {
	text, _ := teamBoardWithTasks(files, chat, lang)
	return text
}

// teamBoardWithTasks is renderTeamBoardWithTasks and whether it shows live work: a member line
// in work (teamBoardMembers) or a task card in the index (only running / waiting are listed).
func teamBoardWithTasks(files []teamFile, chat string, lang Language) (string, bool) {
	var members []teamTaskMember
	for _, f := range files {
		for _, task := range f.Tasks {
			if chatOf(task.SessionKey) == chat && listedTaskState(task.State) && boardTaskURL(task.URL) {
				members = append(members, task.Members...)
			}
		}
	}
	board, live := teamBoardMembers(files, chat, members)
	index, indexLive := renderTeamTaskIndex(files, chat, lang)
	if index != "" {
		board = strings.TrimRight(board, "\n") + "\n\n" + index
	}
	return board, live || indexLive
}

// renderTeamTaskIndex lists this chat's running and waiting task cards: the pinned board's
// task links (docs/PUBLIC_PROGRESS.md). It stays separate from the 谁在干啥 roster, which the
// quiet board drops, so a real task still creates and updates a board without member lines.
func renderTeamTaskIndex(files []teamFile, chat string, lang Language) (string, bool) {
	type entry struct {
		teamTaskLink
		name, project string
	}
	var tasks []entry
	seen := map[string]bool{}
	for _, f := range files {
		for _, task := range f.Tasks {
			key := f.Project + "/" + task.ID
			if seen[key] || chatOf(task.SessionKey) != chat || !listedTaskState(task.State) || !boardTaskURL(task.URL) {
				continue
			}
			seen[key] = true
			tasks = append(tasks, entry{task, f.Name, f.Project})
		}
	}
	if len(tasks) == 0 {
		return "", false
	}
	sort.Slice(tasks, func(i, j int) bool {
		a, b := tasks[i], tasks[j]
		if (a.State == TaskStateWaitingUser) != (b.State == TaskStateWaitingUser) {
			return a.State == TaskStateWaitingUser
		}
		if !a.UpdatedAt.Equal(b.UpdatedAt) {
			return a.UpdatedAt.After(b.UpdatedAt)
		}
		return a.project+"/"+a.ID < b.project+"/"+b.ID
	})
	i18n := NewI18n(lang)
	var lines []string
	var group MsgKey
	shown, length := 0, 0
	for _, task := range tasks {
		key := MsgBoardTasksRunning
		if task.State == TaskStateWaitingUser {
			key = MsgBoardTasksWaiting
		}
		line := fmt.Sprintf("• [%s](%s) · %s", taskIndexLabel(task.Title, 50), task.URL, taskIndexLabel(task.name, 20))
		if task.URL == "" {
			line = fmt.Sprintf("• %s · %s", taskIndexLabel(task.Title, 50), taskIndexLabel(task.name, 20))
		}
		heading := ""
		if key != group {
			heading = "**" + i18n.T(key) + "**"
			if len(lines) > 0 {
				heading = "\n" + heading
			}
		}
		// Bound the whole index, and never truncate a Markdown URL. Source: the
		// previous same 12-link / 3000-rune bound within one platform embed.
		if shown == 12 || length+len([]rune(line+heading)) > 3000 {
			break
		}
		if heading != "" {
			lines = append(lines, heading)
			group = key
		}
		lines = append(lines, line)
		length += len([]rune(line + heading))
		shown++
	}
	if shown < len(tasks) {
		lines = append(lines, i18n.Tf(MsgBoardTasksMore, len(tasks)-shown))
	}
	return strings.Join(lines, "\n"), true
}
