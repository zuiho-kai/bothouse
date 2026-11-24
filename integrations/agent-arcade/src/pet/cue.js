// The same content-free marks appear on Ju and on the desk robot's display.
// Keep service problems visible even when there is also a reply waiting.
const cues = new Map([['thinking', '…'], ['failed', '×'], ['unknown', '?']]);
const labels = {
  zh: {'×': '回复失败', '?': '状态未知', '!': '有事项待查看', '…': '正在生成回复'},
  en: {'×': 'Reply failed', '?': 'Status unknown', '!': 'Something needs your attention', '…': 'Generating a reply'},
};

export function showActivityCue(node, activity, attention, language) {
  const marks = activityCue(activity, attention);
  node.hidden = !marks;
  for (const [i, badge] of Array.from(node.children).entries()) {
    badge.textContent = marks[i] || '';
    badge.hidden = !marks[i];
  }
  const label = Array.from(marks, mark => labels[language][mark]).join(language === 'zh' ? '，' : ', ');
  node.setAttribute('aria-label', label);
  node.title = label;
}

export function activityCue(activity, attention) {
  const mark = cues.get(activity) || '';
  if (!attention) return mark;
  return activity === 'failed' || activity === 'unknown' ? mark + '!' : '!';
}
