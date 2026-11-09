/**
 * 气泡文案表：工具名 → 一句话，命令名 → 一句话。
 *
 * 纯数据，不含判定；加工具或改语气只改这里。
 * 必须始终成立：每句都带具体对象，不说空话；不出现参数值（可能含 token 或内网地址）。
 * @module dsh-pet/src/host/tool-detail/copy
 */
import { fileTarget, filesTarget, firstStr, queryTarget, urlHost } from './target.ts';

/** 句子里可用的占位符：{target} 目标名、{cmd} 命令名。 */
export type CopyLine = string;

/** 从解析后的参数里取「目标」（文件名 / 搜索词 / 域名…）；取不到 → null。 */
type TargetPicker = (args: Record<string, unknown>) => string | null;

/** 只描述「怎么取目标」，不含任何文案（文案全部在下面的表里）。 */
export interface ToolRule {
  pick: TargetPicker;
  /**
   * 目标是不是路径：只有路径才做「太长只留文件名」的压缩。
   * 描述、搜索词、域名这类文本不该被 `/` 切开。
   */
  path?: boolean;
}

/** 文件名/图片类：每句都带 {target}。 */
const FILE_COPY: readonly CopyLine[] = ['翻翻 {target} 看看嘛', '{target} 里面写了啥呢', '我先瞅瞅 {target} 哈'];

/** 写文件。 */
const WRITE_COPY: readonly CopyLine[] = ['写点东西到 {target}', '{target} 马上写出来', '给 {target} 添点料'];

/** 改文件。 */
const EDIT_COPY: readonly CopyLine[] = ['{target} 得改改啦', '我来动动 {target} 哦', '{target} 这里要修一下'];

/** 找文件。 */
const GLOB_COPY: readonly CopyLine[] = ['{target} 都躲哪儿了呢', '找找 {target} 在不在', '{target} 藏在哪个角落呀'];

/** 搜内容。 */
const GREP_COPY: readonly CopyLine[] = ['{target} 藏哪儿了呢', '搜搜 {target} 在哪', '哪儿有 {target} 呀'];

/** 给人看文件。 */
const PRESENT_COPY: readonly CopyLine[] = ['给你看 {target} 哦', '{target} 拿来给你瞧瞧', '喏，{target} 在这儿'];

/** 学技能。 */
const SKILL_COPY: readonly CopyLine[] = ['学个新本事 {target}', '{target} 这招得记住', '把 {target} 学起来'];

/** 委派子任务。 */
const SUBAGENT_COPY: readonly CopyLine[] = ['叫人搭把手：{target}', '让帮手去看看 {target}', '{target} 交给帮手了'];

/** 一个工具的文案：3 句带 {target} 的说法 + 目标太长时的一句纯氛围兜底。 */
export interface ToolCopy {
  readonly lines: readonly CopyLine[];
  /** 目标超过 TARGET_DISPLAY_MAX 时用：不出现文件名与工具名（气泡是氛围，不是信息面板） */
  readonly short: CopyLine;
}

/** 工具 → 文案。没列在这里的工具走 UNKNOWN_TOOL_LINE。 */
export const TOOL_COPY: Readonly<Record<string, ToolCopy>> = {
  read: { lines: FILE_COPY, short: '翻翻代码看看' },
  read_image: {
    lines: ['这 {target} 长啥样呀', '让我瞧瞧 {target} 呗', '{target} 是张什么图呢'],
    short: '看看这张图是啥',
  },
  write: { lines: WRITE_COPY, short: '写点东西进去' },
  edit: { lines: EDIT_COPY, short: '这里得改改' },
  str_replace_editor: { lines: EDIT_COPY, short: '这里得改改' },
  glob: { lines: GLOB_COPY, short: '找找东西在哪' },
  grep: { lines: GREP_COPY, short: '到处翻翻看' },
  present: { lines: PRESENT_COPY, short: '拿个东西给你看' },
  skill: { lines: SKILL_COPY, short: '学个新本事' },
  subagent: { lines: SUBAGENT_COPY, short: '叫人来搭把手' },
  subagent_fork: { lines: SUBAGENT_COPY, short: '叫人来搭把手' },
  workflow: {
    lines: ['把活排个序，开工咯', '几件事一起安排上', '按顺序一件件来'],
    short: '把活排一排',
  },
  web_search: {
    lines: ['我去查查 {target}', '{target} 得搜搜才知道', '上网问问 {target} 吧'],
    short: '上网查查',
  },
  web_fetch: {
    lines: ['去 {target} 瞅瞅有啥', '{target} 这页我翻翻', '看看 {target} 上写了啥'],
    short: '去网上看看',
  },
};

/** 未知工具：只说一句氛围话，不报工具名（`str_replace_editor` 这种名字上屏很怪）。 */
export const UNKNOWN_TOOL_LINE: CopyLine = '这工具是干嘛的';

/** 兜底：没进表的命令（npm / python / node / tsc / eslint / docker…），短命令名会上屏。 */
export const COMMAND_FALLBACK: readonly CopyLine[] = ['跑一下 {cmd} 咯', '{cmd} 跑起来了', '让 {cmd} 干点活'];

/** 兜底：命令名本身太长（如 Get-NetTCPConnection）时用，不带名字。 */
export const COMMAND_NAME_TOO_LONG: CopyLine = '跑一个命令咯';

const CD_COPY: readonly CopyLine[] = ['先把位置挪一挪', '切到那个目录去', '挪个地方继续干活'];

const LS_COPY: readonly CopyLine[] = ['看看这儿都有啥', '这层都有什么东西', '翻翻这里有没有'];

const CAT_COPY: readonly CopyLine[] = ['把内容亮出来瞧瞧', '看看里头写了什么', '读读这份内容'];

const MKDIR_COPY: readonly CopyLine[] = ['建个新文件夹', '腾个地方出来', '新开一个目录'];

const RM_COPY: readonly CopyLine[] = ['把不要的清掉', '这份就别留了', '清理一下这些'];

const MV_COPY: readonly CopyLine[] = ['把东西挪个地儿', '换个位置放', '挪到那边去'];

const CP_COPY: readonly CopyLine[] = ['抄一份留着', '复制一份备用', '再备一份'];

const CURL_COPY: readonly CopyLine[] = ['去问问接口有没有人', '敲敲门看看通不通', '请求一下那个地址'];

const CHECKOUT_COPY: readonly CopyLine[] = ['换到那个分支瞧瞧', '切个分支看看', '换条路继续走'];

/** 命令 / 「命令 子命令」→ 3 句候选（键一律小写，别名共用同一组）。 */
export const COMMAND_COPY: Readonly<Record<string, readonly CopyLine[]>> = {
  cd: CD_COPY,
  'set-location': CD_COPY,
  ls: LS_COPY,
  dir: LS_COPY,
  'get-childitem': LS_COPY,
  cat: CAT_COPY,
  'get-content': CAT_COPY,
  mkdir: MKDIR_COPY,
  'new-item': MKDIR_COPY,
  rm: RM_COPY,
  del: RM_COPY,
  'remove-item': RM_COPY,
  mv: MV_COPY,
  'move-item': MV_COPY,
  cp: CP_COPY,
  'copy-item': CP_COPY,
  curl: CURL_COPY,
  'invoke-webrequest': CURL_COPY,

  // git：没命中子命令时用这一组
  git: ['折腾折腾 git 仓库', '跟 git 打个交道', 'git 这边动一动'],
  'git status': ['看看现在改了些什么', '查查工作区干不干净', '目前是啥状况呢'],
  'git diff': ['瞅瞅这次到底改哪了', '到底动了哪些地方呀', '对比看看都改了啥'],
  'git log': ['让我康康你的提交历史', '翻翻最近都提交了啥', '看看这些天干了什么'],
  'git add': ['先把这些攒起来', '好东西先收进去', '把改动的都登记上'],
  'git commit': ['代码得保存好才行', '打个提交，记一笔', '先存一份再说'],
  'git push': ['该推上去了吧，我来', '推送一下，交给我', '该让远端知道了'],
  'git pull': ['拉一下最新的过来', '把远端的新东西拿回来', '先同步一下再说'],
  'git fetch': ['先问问远端有没有新东西', '悄悄看一眼远端', '拉个最新状态下来'],
  'git checkout': CHECKOUT_COPY,
  'git switch': CHECKOUT_COPY,
  'git branch': ['看看都有哪些分支', '理理这些分支', '新建个分支备用'],
  'git merge': ['把两边合到一起', '合并一下，别打架', '这两条线该合了'],
  'git rebase': ['把历史重新捋一捋', '重新排一下顺序', '理一理提交顺序'],
  'git stash': ['先把改动收起来', '这些先搁一边', '暂时藏起来一下'],
  'git clone': ['把整个仓库搬回来', '照着一份抄下来', '把这份拿下来瞧瞧'],
  'git reset': ['把刚才的退回去', '撤销一下这几步', '回到之前的样子'],
  'git tag': ['给这次打个标记', '贴个版本标签', '记个里程碑'],
};

/**
 * 语义已由别处表达、不该进气泡的工具：
 * `todo_write` 的文案本身就是气泡正文（写它等于自己盖自己）；`ask_user_question` 与 goal 系已有
 * 专门档位（waiting / success / error）；`exit_plan_mode` 是纯内部调度。
 * 这些报出来不是重复就是噪音。
 */
export const SILENT_TOOLS: ReadonlySet<string> = new Set([
  'todo_write',
  'ask_user_question',
  'create_goal',
  'get_goal',
  'update_goal',
  'exit_plan_mode',
]);

/** 取目标的方式（与文案表按工具名关联；pwsh 不在这里，它走命令表）。 */
export const TOOL_RULES: Readonly<Record<string, ToolRule>> = {
  read: { pick: fileTarget, path: true },
  read_image: { pick: fileTarget, path: true },
  write: { pick: fileTarget, path: true },
  edit: { pick: fileTarget, path: true },
  str_replace_editor: { pick: fileTarget, path: true },
  glob: { pick: (args) => firstStr(args, ['pattern', 'path']) },
  grep: { pick: (args) => firstStr(args, ['pattern', 'path']) },
  web_fetch: { pick: urlHost },
  web_search: { pick: queryTarget },
  subagent: { pick: (args) => firstStr(args, ['description']) },
  subagent_fork: { pick: (args) => firstStr(args, ['description']) },
  workflow: { pick: (args) => firstStr(args, ['name', 'description']) },
  skill: { pick: (args) => firstStr(args, ['name']) },
  present: { pick: filesTarget, path: true },
};
