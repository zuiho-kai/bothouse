'use strict';

// Unknown paths fail open to full coverage. Only allowlisted prose and client
// assets can suppress tests; scripts, manifests and embedded input stay covered.
function classify(files, event = 'pull_request') {
  const full = () => ({ go: true, companion: true, dsh: true, docs_only: false });
  if (event !== 'pull_request' || !files.length) return full();
  const result = { go: false, companion: false, dsh: false, docs_only: true };
  for (const path of files) {
    if (/^\.github\/(workflows|actions|ci)\//.test(path) ||
        /\.(sh|bash|zsh|ps1|py|js|mjs|cjs)$/.test(path) ||
        /(^|\/)([^/]*lock[^/]*|go\.(mod|sum)|package\.json|pyproject\.toml|Makefile)$/.test(path)) return full();
    if (/^(README[^/]*\.md|CONTRIBUTING\.md|SECURITY\.md|CODE_OF_CONDUCT\.md|LICENSE(?:\.[^/]*)?)$/.test(path) ||
        /^docs\/.*\.(md|txt|png|jpg|jpeg|gif|svg|webp)$/.test(path) ||
        /^\.github\/(ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE\.md$)/.test(path)) continue;
    result.docs_only = false;
    if (/^dsh\/packages\/client-ui-discord\//.test(path)) result.dsh = true;
    else if (/^companion\//.test(path)) result.companion = true;
    else if (/^bridge\//.test(path) && /\.(go|tsx?|css)$/.test(path)) {
      result.go = true;
      result.dsh = true;
    } else return full();
  }
  return result;
}

module.exports = { classify };
