- Review marks on a dispatch (dispatch-review-guard): a prompt without a mark passes; a mark is checked as follows
  - research, small change, one-off script, code review: 【免审:调研】【免审:小改动】【免审:一次性脚本】【免审:代码审查】 — passes;
  - a review: start with 【审稿】 and quote the user's own words verbatim (in 「」 or “” or ""); the reviewer writes its conclusion (containing 审稿结论) to `{{REVIEWS}}/<name>.md`;
  - a reviewed action may carry 【已审:{{REVIEWS}}/<name>.md】 naming that review file; each file can be used once.
  The main session does not edit code files itself; a subagent does. `~/.claude`, `/tmp` and the wiki directory are exempt. Before editing a document, register it with `{{PYTHON}} {{HOOKS}}/doc-ok.py <file>` (prompts, SPECs and agent definitions are not documents).
- In HOOK_RESEARCHER_DIRS, dispatch research to researcher (or explicitly Sonnet). Unconfigured directories are unaffected. Configure teammate names through HOOK_TEAMMATES.
- Numbers (defined at the top of {{HOOKS}}/dispatch-review-guard.py): a review of a change under 30 lines that touches no bridge, live or money path is sent back ("small change: verify with a script"); in a chat channel the main session may make an edit of up to 10 lines itself.
