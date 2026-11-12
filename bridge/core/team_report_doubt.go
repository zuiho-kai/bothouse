package core

// A held [report] the intent check doubted shows the doubt to the lead, who decides: pass it with a
// verdict, or ws-forward it back. Board #1350 (2026-11-10) made a doubt clear only on a quoted user line
// checked against people/*.jsonl; #1527 (user 2026-11-12 「还后面还有什么可以删的吗？一起搞了吧」) removed
// that: it stopped reports the lead had already judged, and only a real block should stop a report.

const doubtPassRule = "这份有疑点：自己判一下疑点成不成立，成立就 ws-forward 打回，不成立就照常 --verdict 放行（#1527 起不再要求引用户原话）。"
