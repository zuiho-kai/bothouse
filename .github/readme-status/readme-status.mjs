// Collects repository status and renders the README status cards (zh/en, day/night).
// Run by .github/workflows/readme-status.yml; output goes to the readme-status branch.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY = process.env.GITHUB_REPOSITORY || 'zuiho-kai/bothouse';
export const STATUS_BRANCH = 'readme-status';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '<!-- bothouse-readme-status:v1 -->';
const FILES = [
  'stats-zh-day.svg',
  'stats-zh-night.svg',
  'stats-en-day.svg',
  'stats-en-night.svg',
  'stats.json',
  'README.md',
];

const THEMES = {
  day: { shadow: '#5a3317', frame: '#e8833a', bg: '#fffaf3', tile: '#fdeedd', value: '#b4561a', label: '#6b4a33', title: '#3b2414', muted: '#9a7a62' },
  night: { shadow: '#0b0d1a', frame: '#e8833a', bg: '#221d33', tile: '#2e2745', value: '#ffb36b', label: '#d9c4b0', title: '#ffe9d2', muted: '#8f86a8' },
};
const TEXT = {
  zh: {
    title: 'bothouse 仓库状态',
    updated: '更新于',
    labels: ['Stars', 'Forks', '未关闭 Issues', '未关闭 PR', '30 天关闭 PR', '30 天提交', '最新版本'],
    aria: 'bothouse 仓库状态',
  },
  en: {
    title: 'bothouse repository status',
    updated: 'Updated',
    labels: ['Stars', 'Forks', 'Open issues', 'Open PRs', 'PRs closed (30d)', 'Commits (30d)', 'Latest release'],
    aria: 'bothouse repository status',
  },
};
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',-apple-system,'Segoe UI',sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderStatus(stats, lang, theme) {
  const c = THEMES[theme];
  const t = TEXT[lang];
  const values = [
    stats.stars, stats.forks, stats.issues, stats.pullRequests,
    stats.activity.closedPullRequests, stats.activity.commits, stats.release,
  ];
  const updated = `${t.updated} ${stats.updatedAt.replace('T', ' ').replace('Z', ' UTC')}`;
  const n = values.length, x0 = 20, gap = 10, w = (920 - gap * (n - 1)) / n;
  const tiles = values.map((v, i) => {
    const x = x0 + i * (w + gap);
    const size = String(v).length > 6 ? 22 : 28;
    return `<rect x="${x.toFixed(1)}" y="62" width="${w.toFixed(1)}" height="96" rx="12" fill="${c.tile}"/>` +
      `<text x="${(x + w / 2).toFixed(1)}" y="110" font-size="${size}" font-weight="800" fill="${c.value}" text-anchor="middle">${esc(v)}</text>` +
      `<text x="${(x + w / 2).toFixed(1)}" y="140" font-size="13" fill="${c.label}" text-anchor="middle">${esc(t.labels[i])}</text>`;
  }).join('');
  const aria = `${t.aria}: ${t.labels.map((l, i) => `${l} ${values[i]}`).join(', ')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="184" viewBox="0 0 960 184" role="img" aria-label="${esc(aria)}" font-family="${FONT}">` +
    `<title>${esc(aria)}</title>` +
    `<rect x="3" y="5" width="954" height="176" rx="16" fill="${c.shadow}"/>` +
    `<rect x="1" y="1" width="954" height="176" rx="16" fill="${c.frame}"/>` +
    `<rect x="5" y="5" width="946" height="168" rx="13" fill="${c.bg}"/>` +
    `<text x="24" y="42" font-size="19" font-weight="700" fill="${c.title}">${esc(t.title)}</text>` +
    `<text x="936" y="42" font-size="13" fill="${c.muted}" text-anchor="end">${esc(updated)}</text>` +
    tiles + `</svg>\n`;
}

export function githubClient(token, request = fetch) {
  return async (path, method = 'GET', body) => {
    const response = await request(`https://api.github.com/${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid count: ${label}`);
  return value;
}

export function activityWindow(now = new Date()) {
  const until = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const since = new Date(new Date(until).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z');
  return { since, until };
}

export async function collectStatus({
  api,
  git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(),
  now = new Date(),
}) {
  const repo = await api(`repos/${REPOSITORY}`);
  if (repo.full_name.toLowerCase() !== REPOSITORY.toLowerCase()) throw new Error('Unexpected repository');
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('Full default-branch history is required');
  const sha = git(['rev-parse', '--verify', `refs/remotes/origin/${repo.default_branch}^{commit}`]);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid default-branch SHA');
  const { since, until } = activityWindow(now);
  const search = async (query) => {
    const result = await api(`search/issues?q=${encodeURIComponent(`repo:${REPOSITORY} ${query}`)}&per_page=1`);
    if (result.incomplete_results !== false) throw new Error('Incomplete GitHub search; keeping last successful snapshot');
    return count(result.total_count, query);
  };
  const issues = await search('is:issue is:open');
  const pullRequests = await search('is:pr is:open');
  const closedPullRequests = await search(`is:pr is:closed closed:${since}..${until}`);
  const commits = count(Number(git(['rev-list', '--count', `--since-as-filter=${since}`, `--until=${until}`, sha, '--'])), 'commits');
  const release = await api(`repos/${REPOSITORY}/releases/latest`);
  if (!/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Unexpected stable release tag');
  return {
    repository: REPOSITORY,
    updatedAt: until,
    defaultBranch: repo.default_branch,
    defaultBranchSha: sha,
    stars: count(repo.stargazers_count, 'stars'),
    forks: count(repo.forks_count, 'forks'),
    issues,
    pullRequests,
    release: release.tag_name,
    activity: { since, until, closedPullRequests, commits },
  };
}

export function statusFiles(stats) {
  const files = {};
  for (const lang of ['zh', 'en'])
    for (const theme of ['day', 'night']) files[`stats-${lang}-${theme}.svg`] = renderStatus(stats, lang, theme);
  files['stats.json'] = JSON.stringify(stats, null, 2) + '\n';
  files['README.md'] = `${MARKER}
# bothouse repository status / 仓库状态

Last successful update / 最后成功更新: **${stats.updatedAt}**

| Metric / 指标 | Value / 数值 |
| --- | ---: |
| Stars | ${stats.stars} |
| Forks | ${stats.forks} |
| Open issues / 未关闭 Issues | ${stats.issues} |
| Open PRs / 未关闭 PR | ${stats.pullRequests} |
| Closed PRs in 30 days / 30 天内关闭 PR | ${stats.activity.closedPullRequests} |
| Commits in 30 days / 30 天内提交 | ${stats.activity.commits} |
| Latest release / 最新版本 | ${stats.release} |

Window / 统计窗口（UTC）: ${stats.activity.since} → ${stats.activity.until}.

Closed PRs include merged PRs. Commits count all history reachable from the default branch, including merge and bot commits. GitHub search can lag behind recent events.

关闭 PR 包含已合并 PR。提交按默认分支所有可达历史统计，包含合并提交和机器人提交。GitHub 搜索可能有延迟。

Default branch / 默认分支: [${stats.defaultBranch} at ${stats.defaultBranchSha}](https://github.com/${REPOSITORY}/commit/${stats.defaultBranchSha}).

Updated every six hours. A failed run keeps the last successful snapshot. / 每六小时更新，任务失败时保留上次成功结果。

[JSON](stats.json) · [Workflow / 工作流](https://github.com/${REPOSITORY}/actions/workflows/readme-status.yml)
`;
  return files;
}

export async function publishStatus(api, files, repository = REPOSITORY, branch = STATUS_BRANCH) {
  if (branch !== STATUS_BRANCH) throw new Error('Only the dedicated status branch can be published');
  if (Object.keys(files).sort().join() !== [...FILES].sort().join() || !files['README.md'].startsWith(MARKER))
    throw new Error('Invalid status file set');
  const base = `repos/${repository}/git`;
  let parent;
  try {
    parent = (await api(`${base}/ref/heads/${branch}`)).object.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  let baseTree;
  if (parent) {
    const tree = await api(`${base}/trees/${parent}`);
    if (tree.truncated || tree.tree.some((e) => !FILES.includes(e.path) || e.type !== 'blob'))
      throw new Error('Unexpected status branch contents');
    const readme = tree.tree.find((e) => e.path === 'README.md');
    const blob = readme && (await api(`${base}/blobs/${readme.sha}`));
    if (!blob || !Buffer.from(blob.content, 'base64').toString('utf8').startsWith(MARKER))
      throw new Error('Status branch ownership marker missing');
    baseTree = (await api(`${base}/commits/${parent}`)).tree.sha;
  }
  const tree = await api(`${base}/trees`, 'POST', {
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree: FILES.map((path) => ({ path, mode: '100644', type: 'blob', content: files[path] })),
  });
  if (tree.sha === baseTree) return parent;
  const commit = await api(`${base}/commits`, 'POST', {
    message: 'docs: refresh README repository status',
    tree: tree.sha,
    parents: parent ? [parent] : [],
  });
  if (parent) await api(`${base}/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
  else await api(`${base}/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  return commit.sha;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, directory] = process.argv.slice(2);
  if (!['collect', 'publish'].includes(command) || !directory)
    throw new Error('Usage: node .github/readme-status/readme-status.mjs collect|publish <output-directory>');
  const api = githubClient(process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN);
  if (command === 'collect') {
    const stats = await collectStatus({ api });
    const files = statusFiles(stats);
    mkdirSync(directory, { recursive: true });
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(directory, name), contents);
    console.log(`Collected ${stats.updatedAt} from ${stats.defaultBranchSha}`);
  } else {
    const files = Object.fromEntries(FILES.map((name) => [name, readFileSync(join(directory, name), 'utf8')]));
    console.log(`Published ${await publishStatus(api, files)} to ${STATUS_BRANCH}`);
  }
}
