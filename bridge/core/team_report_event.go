package core

// EventWorkspaceReport fires when a workspace hands back a [report] (holdReportForLead). Fields:
// board, short, dispatcher (the project that handed the work out, from the board row), chat (the
// chat it came from, "<platform>:<id>"), workspace, acceptor (the project woken to accept it, ""
// when none was), batch. Text: the report as written. Any `bothouse cron add --event
// workspace.report` job runs on it (cron_event.go).
const EventWorkspaceReport = "workspace.report"
