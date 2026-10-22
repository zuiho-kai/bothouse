- Say whether a dispatch was reviewed (dispatch-review-guard): start every subagent prompt with one of
  - research, small change, one-off script, code review: 【免审:调研】【免审:小改动】【免审:一次性脚本】【免审:代码审查】 — passes;
  - a review: start with 【审稿】 and quote the user's own words verbatim (in 「」 or “” or ""); the reviewer writes its conclusion (containing 审稿结论) to `{{REVIEWS}}/<name>.md`;
  - any other new action: 【已审:{{REVIEWS}}/<name>.md】 naming that review file; each file can be used once.
  The main session does not edit code files itself; a subagent does. `~/.claude`, `/tmp` and the wiki directory are exempt. Before editing a document, register it with `{{PYTHON}} {{HOOKS}}/doc-ok.py <file>` (prompts, SPECs and agent definitions are not documents).
