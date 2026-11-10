# 成员个人目录和各自的 GitHub 授权（#1355）

多人共用一个团队时，每个真人有自己的目录，GitHub 各用各的授权，别人那一轮用不了。

## 怎么开

- 安装向导：团队有两个以上角色时，最后一页有「成员个人目录（推荐团队开）」，默认不勾，勾了才开。
- 对主角色说：用户说要搞团队时，主角色会推荐这一项；主人点头，主角色在主人那一轮跑 `bothouse member enable`，写进 config.toml 并马上生效。不点头不开。
- 配置：`[[projects]]` 里 `member_workspaces = true`（默认关）。

## 开了之后会发生什么

1. 有人进群（`member.joined`，机器人除外）：桥在 `<data_dir>/members/<平台>-<账号id>/` 建他的目录（0700），里面有 `files/`（替他干活放文件）、`.gh-config/`（他自己的 GitHub 凭据）、`github.md`（授权记录，不含令牌）。同一个人重复送达的加入事件只处理一次。
2. 桥叫醒主角色一轮（原文不发到频道），告诉它已经做了什么：建了目录还是目录本来就在，他有没有授权。主角色欢迎他，说清已经做的事；没授权就问他要不要配自己的 GitHub。
3. 他同意后，主角色在他说话的那一轮跑 `bothouse member login`。桥起 `gh auth login` 设备码流程，设备码只发给他本人：走私信；Discord 拒收（他不收服务器成员私信）就发到他说话那个频道下的私密子话题，只有他和服务器管理员看得到；两条都不通就什么也不发，并取消这次授权。设备码不贴进公开频道。他在 GitHub 页面确认后，桥记下账号并告诉他。
4. 之后替他做 GitHub 的事：`bothouse member gh …`、`bothouse member git …`。桥按这一轮真实的发话人取他自己的凭据来跑；他没授权就拒绝，不借别人的。共享环境里的 `GH_TOKEN`、`GITHUB_TOKEN` 不传给这些命令。
5. 他退出服务器（`member.left`）：本机凭据删除，`github.md` 记一笔；他的 `files/` 保留，回来还在。GitHub 上的授权要他自己到 GitHub → Settings → Applications 撤销，记录里写了。他也可以随时说「撤销我的 GitHub 授权」，主角色跑 `bothouse member logout`。

## 「别人不能访问」靠什么保证

- 用谁的凭据由桥定，不由模型定：`bothouse member` 不接受「替谁」这种参数，桥按发起人身份（[CALLER_IDENTITY.md](CALLER_IDENTITY.md)）查这一轮是谁发起的。队友 bot、定时任务、交接叫醒、本地输入发起的轮次一律拒绝。所以经这条路，甲那一轮用不了乙的授权。
- 文件层面要看部署：
  - 角色换一个系统账号跑（项目配 `run_as_user`；Claude Code 和 Codex 支持，两家都在 Linux 一次性容器里实测过，macOS 上没实测）：成员目录归桥的账号、权限 0700，角色进程打不开，是操作系统内核拦的。**但 `run_as_user` 下 `bothouse member` 的子命令现在都不可用**（`status`、`login`、`gh`、`git`、`put`、`get`、`ls` 全在内），别把它们当成这个模式下的用法。两处断点：桥的 `api.sock` 是 0600、只有桥的账号能连（`bridge/core/api.go` 建完 socket 就 `os.Chmod(…, 0o600)`，`bridge/core/identity_api.go` 把 0600 当设计前提）；角色进程的环境里也没有 `CC_PROJECT`/`CC_SESSION_KEY`/`CC_DATA_DIR`，`FilterEnvForSpawn` 按只留 `LANG`/`LC_*`/`TERM` 的白名单过滤后，CLI 直接以 `member: CC_SESSION_KEY not set` 退出（`bridge/core/runas.go` 的 `DefaultEnvAllowlist`）。所以这个模式下角色读不到成员的 `files/`，替他存取文件只能由桥自己做，不要让模型去跑 `member put`/`get`/`ls`。打通要另做一件：给 `/member` 加调用者校验之后才谈得上放开 socket，只改权限会造出跨成员冒用。
  - Codex 换账号跑时用的是角色账号自己的 `~/.codex`（登录、配置都在那里）；配了 `codex_home` 的话，那个目录要角色账号读写得了。桥这边列历史会话、读用量时看的是桥账号的目录，可能看不到角色账号下的会话，按会话 id 接着聊不受影响。
  - 剩下的口子：同一个角色账号上同时跑着两个成员的活时，`member gh|git` 运行那几秒里令牌在那个进程的环境里，同账号的另一个进程理论上读得到。要堵这一条得每个成员一个系统账号，现在没做。
  - 角色和桥同一个系统账号（默认装法）：这不算隔离。目录对角色进程是可读的，能拦住的只是「经正常命令拿别人的凭据」，拦不住一个绕开命令、直接去读文件的角色；那一层只靠给角色的规矩。要真隔离，开 `run_as_user`。
- 凭据不进日志、事件记录和聊天：桥日志只记成员 id、操作和退出码。
