# 好友服务单机部署

一台 Linux 主机以 Caddy 提供 HTTPS，运行同一源码版本的社交页面和 Node API。SQLite 放在主机的持久磁盘，替换源码或重启服务时继续使用同一个库。需要运营方授权使用一台可公开访问的主机及其 DNS 名称。域名须指向该主机，TCP 80/443 须从互联网可达。示例假定 Caddy 直接接收客户端连接，Node 的 8787 仅监听 `127.0.0.1`。证书由 Caddy 为真实域名申请和续期。[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)

## 安装

### 可选 AI 语音

日用普通话可使用微软 Azure Speech 的晓晓、晓伊和云希。运营方在系统服务的私密环境文件填写 `SOCIAL_AZURE_SPEECH_REGION` 和 `SOCIAL_AZURE_SPEECH_KEY`，须有可用的 Azure Speech 资源和到该区域语音端点的 HTTPS 出站。服务只提交合成所需台词，收到 16 kHz PCM 后封装成聊天 WAV。Azure F0 当前列有每月 50 万字符的神经语音额度，额度外费用及可用性取决于实际资源等级和区域。[REST 接口](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech) · [普通话音色](https://learn.microsoft.com/zh-cn/azure/ai-services/speech-service/language-support?tabs=tts) · [价格与免费额度](https://azure.microsoft.com/en-us/pricing/details/speech/)

好友服务仅使用配置好的 Azure 云语音。旧离线音色授权不会转成云授权。未配置云语音或该次合成失败时，回复保留为文字。

普通朋友在 AI 会话里点「AI 音色」，试听并为角色保存一次。每个会话仍须单独允许当前合成服务，改用另一种合成服务也需要重新允许。选择「停止本会话语音」只影响这里。朋友端只需登录即可收听。AI 按本轮原文合成一条可重播语音，上限为 600 字符和 120 秒。超过上限或合成失败时保留完整文字。要求核对或打字的回合使用文字。真人录音仍为 30 秒。恢复备份会清除旧音色和语音许可，保留已保存音频。

### 基础服务

先在主机安装 Caddy 2、Node 24.18 或更新的 24.x，以及用于暂存的 Python 3.11+。下面以 `/usr/local/bin/node` 为例，若安装路径不同，同步调整 unit 的 `ExecStart` 和备份命令。服务运行不需要 npm 安装依赖。

Windows MSIX 与好友服务可同版发行，也可独立升级好友服务。独立升级时，分别核对桌面交接和服务交接的冻结提交与版本；两份交接的 HTTPS 原点必须一致，部署的 `SOCIAL_PUBLIC_ORIGIN` 和代理站点也用该原点。原点仍相同的桌面测试包可沿用，配对前检以原桌面交接传入 `--handoff`，以候选服务交接传入 `--service-handoff`，并以当前已签服务交接传入 `--previous-service-handoff`。切换前必须从同一命令取得 `serviceUpgrade.status: verified`，它包含在原会话里恢复草稿并让群友收到的浏览器回环证据。Windows 配对与前检见同版完整 source.zip。先在好友页「开源与版本」下载源码（也可用部署交接配套的 source.zip），解压后从源码根目录打开 social/windows/README.md 的「公开地址与同版成品检查」。

服务 ZIP 的 [Git 导出清单](service-archive-paths.txt) 包含 `social/assets/stickers` 下的随版 PNG、可编辑源和授权说明，也包含贴图和真人附图运行依赖的共享模块。浏览器验收脚本和服务测试保存在完整 source.zip 中，部署 ZIP 只带服务所需的代码、资源、许可证和运维文件。部署时保留归档目录结构。用新注册的测试账号打开收到的角色贴图及原图详情，验证运行中的服务可以读取图像并显示来源。

```sh
# 发行负责人在冻结提交的工作树根目录导出服务 ZIP。
git archive --format=zip --output=/path/to/AgentArcadeSocialService.zip HEAD -- $(cat social/deploy/service-archive-paths.txt)
```

### 交付此版对应源码

从当前好友服务的 `service-handoff.json` 取服务 ZIP 路径、SHA-256 和服务版本，并选同一服务冻结的 `source.zip` 与 `source-handoff.json`。保留两份源码文件的相对位置，使 `source.path` 指向该服务的源码 ZIP。下方 `--version` 填服务版本；例如已验配对中桌面为 1.0.21.0，服务为 1.0.25.0，这里取 1.0.25.0 的三件服务文件并填写 1.0.25.0。误用桌面源码交接会在暂存时因版本或文件内容不符被拒，修正输入后再安装。先核对服务 ZIP 再解包，使用包内的暂存工具核对版本、Git 提交、源码 ZIP 摘要及服务清单文件，生成 `source-release.json`。整目录安装到新发布目录，保留根目录许可、静态资源、源码 ZIP 和版本元数据。输入归档保持原样。升级时先完成发布目录的安装，再按下方升级步骤切换 `current`。

```sh
root=/opt/agent-arcade-social
version=SERVICE_VERSION_FROM_HANDOFF
service_zip=/path/to/AgentArcadeSocialService.zip
service_sha256=SERVICE_ZIP_SHA256
source_handoff=/path/to/service-release/source-handoff.json

printf '%s  %s\n' "$service_sha256" "$service_zip" | sha256sum -c - || exit 1
staging=$(mktemp -d) || exit 1
python3 -m zipfile -e "$service_zip" "$staging" || exit 1
python3 "$staging/social/deploy/stage-release-source.py" service \
  "$staging" "$source_handoff" "$staging" --version "$version" || exit 1

release="$root/releases/$version"
sudo install -d -m 0755 "$root/releases" || exit 1
sudo mkdir -m 0755 "$release" || exit 1
sudo cp -R "$staging"/. "$release"/ || exit 1
sudo chmod -R u=rwX,go=rX "$release" || exit 1
```

相同版本的发行目录若已存在，暂存命令会停在 `mkdir`，可核对并复用已验证内容。复制失败时，先确认该目录从未启用，再处理不完整的目录。暂存本身只写新发行目录。

### 首次安装

在完成暂存的同一终端执行。此步骤要求 `current`、环境配置和 unit 路径均未占用，包含断开的符号链接。已有服务走「正常升级」。同一主机一次执行一项部署操作。

```sh
env_file=/etc/agent-arcade-social/service.env
unit_file=/etc/systemd/system/agent-arcade-social.service
test -s "$release/source-release.json" || exit 1
for target in "$root/current" "$env_file" "$unit_file"; do
  if sudo test -e "$target" || sudo test -L "$target"; then
    printf '路径已存在，停止首装：%s\n' "$target" >&2
    exit 1
  fi
done

getent passwd agent-arcade-social >/dev/null || \
  sudo useradd --system --no-create-home --user-group --shell /usr/sbin/nologin agent-arcade-social || exit 1
sudo install -d -m 0750 /etc/agent-arcade-social || exit 1
sudo sh -c 'umask 077; set -C; cat "$1" > "$2"' sh \
  "$release/social/deploy/service.env.example" "$env_file" || exit 1
sudoedit "$env_file" || exit 1
sudo sh -c 'umask 022; set -C; cat "$1" > "$2"' sh \
  "$release/social/deploy/agent-arcade-social.service" "$unit_file" || exit 1
sudo ln -sT -- "$release" "$root/current" || exit 1
sudo systemctl daemon-reload || exit 1
sudo systemctl enable --now agent-arcade-social || exit 1
sudo systemctl is-active --quiet agent-arcade-social || exit 1
```

编辑环境配置时填好获授权的原点及公开联系方式。如果首装中断，先逐项核对哪些文件已建，再从未完成的步骤继续。已有文件留在原处。

服务启动时校验安装后的源码 ZIP。用暂存版的回环服务查看 `/source.html`，从页面链接匿名下载 ZIP，核对版本、提交及源码 SHA-256。正式启用后，在好友登录前或「我 → 开源与版本」可找到同一入口。Windows 设置中的离线源码对应原 MSIX。通过好友服务匿名获取的源码对应当前服务交接。开发环境省略两份源码文件时，页面会提示无下载。

鲸鱼娘的私聊和群聊使用 `SOCIAL_DEEPSEEK_KEY`（DeepSeek Flash）。龙娘的私聊和群聊使用独立的 `SOCIAL_OPENAI_KEY`（GPT Responses API）。橘娘的私聊和群聊使用 `SOCIAL_ANTHROPIC_KEY`（Claude Opus 5.5）。在服务主机的私密凭据文件填写想开放的服务密钥，再启动服务。橘娘使用运营方配置的 Anthropic API 密钥。朋友从「通讯录 → AI 联系人」同意后可开始私聊。群主从「群成员 → 群内 AI」加入橘娘，每位群友分别同意使用 Claude 后可点名聊天。真人聊天无需模型密钥。[Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create) · [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5)

每段私聊或每个群同时处理一轮，每天最多 12 次请求。整台服务共享同时最多 4 轮、每天最多 100 次的限制，按 UTC 计数。已提交到模型的失败请求也计入次数，同一条消息重试不会重复扣次。

`SOCIAL_ANTHROPIC_KEY` 请填在 Claude Console 创建且绑定单一 Workspace 的 API key。未绑定 Workspace 的 key 需要附带 `anthropic-workspace-id`，当前部署配置只支持单 Workspace key。[Anthropic 认证说明](https://platform.claude.com/docs/en/api/overview#authentication)

鲸鱼娘、橘娘和龙娘的动态分别沿用其已有 DeepSeek、Claude（Anthropic）和 OpenAI 云服务。三位角色共享整台服务的并发和日额度。只在某角色至少有一位关注者时，服务才会在每天 08:00 至 11:00 UTC 为该角色最多请求一次，可发表一条短文字或保持安静。失败或中途重启后等待下一个日窗口。普通重启保留关注和已用机会。准备灾备恢复副本时会同时清除角色关注，用户可在好友动态重新选择。

使用好友群云生图时，运营方可在同一个私密环境文件配置 `SOCIAL_CLOUDFLARE_ACCOUNT_ID` 与 `SOCIAL_CLOUDFLARE_API_TOKEN`，并为该账户签发可调用 Workers AI 的令牌。文本按固定 `@cf/black-forest-labs/flux-2-klein-4b` 模型生成 1024 × 1024 图片。实际计费使用 Cloudflare 账户的用量和套餐。好友服务另设每群每天 3 次、整站默认 12 次的预留上限（UTC）。整站可用 `SOCIAL_CLOUDFLARE_DRAW_DAILY` 设为 1 到 100。已经发起的失败或取消也保守计入次数，重投和重发原图不重新生成。[Cloudflare 模型](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/) · [Workers AI 价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)

配置好云生图后，已经入群的角色默认可用。群友同意该角色的云聊天后可点名请她画图。群主仍可在「群成员 → 群内 AI」关闭。旧版会删除关闭所对应的设置行，这类与旧默认无法区分的缺省状态随升级采用新默认。新版本记录明确关闭，保留到后续重启。普通风景（如「画一张雨夜的灯塔」）只向 Cloudflare Workers AI 发送当条画面描述。画默认角色本人，或明确参考她的公开头像时，还会发送服务随包的对应公开头像。群主从本机角色库选用自定义角色后，该角色只能用本群另行批准的卡面作为参考（例如「画一张你自己抱蓝纸灯的表情」）。可在「本群角色卡」撤销绘图卡面，也可换卡后按需重新批准。朋友端无需 key。成图留在受会话权限保护的 SQLite 附件里，准备旧档恢复副本时会关闭各群生图并清除原卡面批准。

鲸鱼娘、龙娘和橘娘的私聊主动联系分别使用已配置的 DeepSeek、OpenAI 和 Claude，与各自的云聊天共享现有额度。接受好友申请、允许云聊天和开启联系时段分别由用户决定。好友服务持续运行时，在启动和每分钟检查已明确开启的账号。按收件人保存的本地时段和日期安排，每次机会最多一句，可保持安静。调用失败或中断后的同一机会不会重跑。只关闭客户端窗口不影响送达，恢复云聊天和灾备恢复都需要用户重新开启主动联系。

把 `SOCIAL_PUBLIC_ORIGIN` 改为授权域名的完整 `https://` 地址。Caddy 的站点名与它对应；示例默认保留 `8787`，若修改端口，同时修改代理上游。专用新主机可用示例 `Caddyfile` 作为 `/etc/caddy/Caddyfile`，把 `social-proxy.caddy` 安装到同一个目录，并替换站点名。已有 Caddy 站点时保留原文件，在其中添加一个 `import /etc/caddy/agent-arcade-social/Caddyfile`，两份文件放到该子目录内。务必先验证再启用或重载。

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
systemctl is-active agent-arcade-social caddy
```

### 正常升级

先按「交付此版对应源码」暂存新发行。沿用现有服务用户、unit、`service.env`、代理和持久库。检查发行说明中的同库升级要求以及新旧随包 unit 差异。若随包 unit 有改动，先核对本机 unit 的兼容性并单独安排该改动。以下命令在一次升级操作中执行，`db` 与 `origin` 按已生效的 `SOCIAL_DB` 与 `SOCIAL_PUBLIC_ORIGIN` 填写，保持原配置文件私密。

```sh
root=/opt/agent-arcade-social
version=SERVICE_VERSION_FROM_HANDOFF
release="$root/releases/$version"
state=/var/lib/agent-arcade-social
db="$state/social.sqlite"
origin=https://YOUR_APPROVED_HOST
test -L "$root/current" || exit 1
previous=$(readlink -f -- "$root/current") || exit 1
case "$previous" in "$root/releases/"*) ;; *) exit 1 ;; esac
test -d "$previous" && test "$previous" != "$release" && \
  test -s "$release/source-release.json" && test -s "$release/source.zip" && \
  test -r "$release/social/server/main.cjs" || exit 1
cmp -s "$previous/social/deploy/agent-arcade-social.service" \
  "$release/social/deploy/agent-arcade-social.service" || exit 1

sudo install -d -m 0700 -o agent-arcade-social -g agent-arcade-social "$state/backups" || exit 1
backup_dir="$state/backups/pre-$version-$(date -u +%Y%m%dT%H%M%SZ)"
sudo -u agent-arcade-social /usr/local/bin/node \
  "$previous/social/deploy/backup.cjs" "$db" "$backup_dir" || exit 1
sudo test -s "$backup_dir/social.sqlite" || exit 1
printf '上版目录：%s\n升级前快照：%s\n' "$previous" "$backup_dir"

switch_dir=$(sudo mktemp -d "$root/.switch.XXXXXXXX") || exit 1
sudo ln -sT -- "$release" "$switch_dir/current" || exit 1
sudo systemctl stop agent-arcade-social || exit 1
test -L "$root/current" && test "$(readlink -f -- "$root/current")" = "$previous" || exit 1
sudo mv -Tf -- "$switch_dir/current" "$root/current" || exit 1
sudo rmdir -- "$switch_dir" || exit 1

if sudo systemctl start agent-arcade-social &&
    curl --fail --silent --show-error --retry 5 --retry-connrefused --max-time 5 "$origin/healthz" &&
    sudo systemctl is-active --quiet agent-arcade-social; then
  printf '\n已启动：%s\n' "$release"
else
  sudo systemctl stop agent-arcade-social
  sudo journalctl -u agent-arcade-social -n 80 --no-pager
  printf '升级未通过，保留当前库和升级前快照：%s\n' "$backup_dir" >&2
  exit 1
fi
```

切换用同一文件系统内的重命名替换 `current` 链接，前后版本目录均保留。启动后从 `/source.html` 核对源版本与摘要，再用隔离测试号检查登录与收件。若切换命令、启动或健康检查失败，先确认 Node 服务已经停止，保留现有 SQLite 与同名 WAL、SHM（若存在）和升级前快照。排查修复后可用新版本重启。确需切回上一发行目录时，先核对旧版能打开当前库，再用同样的临时链接与重命名切回。未经核对，保持停止并用工作副本验证。升级前快照可能缺少其后的写入，须按下节灾备流程处理。

代理覆盖客户端提供的 `X-Real-IP`，服务通过该值做来源限速。若以后使用 CDN 或其他代理，需另外核对地址信任与限速。[Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

### 公开试用：网页搜索

入群角色可在默认开启的公开网页搜索中查公开主题。群主仍可在「会话设置 → 公开网页搜索」关闭，能核实的旧关闭值继续生效。AI 私聊仍由用户决定是否开启搜索。群友须已同意该角色的云聊天，并明确点名请它搜索。服务只把这条消息的公开主题词发给 Mwmbl，返回标题和链接，可在「来源说明」查看署名与许可。

此版使用 Mwmbl 匿名免费档，运营者和朋友都无需填写搜索密钥，搜索请求没有 Mwmbl 费用，也不会转为付费请求。官方上限为同一出口 IP 每秒 1 次、每月 1,000 次。同一出口的朋友及其他匿名调用者共享额度，无法承诺剩余次数。短时限流可稍后再试；月额度用完后须等下月首日重置。两种超限在会话里都显示「公开搜索暂时限流」，服务暂不可用时会提示没能取回结果。普通真人聊天可继续，AI 普通聊天仍按原有授权、模型服务及日用量限制运行。搜索本身也占用一轮应用内 AI 回复额度，但这轮检索不调用聊天模型。[Mwmbl 开发者定价与额度](https://developer.mwmbl.org/)

Mwmbl 搜索结果按 CC BY-NC-SA 4.0 提供。此功能用于非商业试用与分享，保留署名，适用时须以同一许可分享；软件开源和搜索免费均不授予搜索结果的商用权。[Mwmbl API 条款](https://developer.mwmbl.org/terms/) · [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

## 持久化、备份与还原

`systemd` 创建仅服务用户可读写的 `/var/lib/agent-arcade-social`。把该目录放在持久磁盘。数据库在线时用 SQLite 自带的备份接口，包含已提交的 WAL 内容。输出目录必须是新目录。通过完整性和基本表结构检查之后才会出现 `social.sqlite`。

```sh
state=/var/lib/agent-arcade-social
sudo install -d -m 0700 -o agent-arcade-social -g agent-arcade-social "$state/backups"
sudo -u agent-arcade-social /usr/local/bin/node \
  /opt/agent-arcade-social/current/social/deploy/backup.cjs \
  "$state/social.sqlite" "$state/backups/$(date -u +%Y%m%dT%H%M%SZ)"
```

备份含用户号、密码哈希、登录会话和消息，按私有数据保管并在授权的独立存储留副本。

### 灾备恢复旧快照

**1.0.39.0 同版灾备已验。** 选择快照前先核对时间和写入版本，保全当前库，并用固定 .39 发布目录的工具对 .39 快照执行下方命令。只读回快照时间点的数据；后续写入保留在当前库或更新的备份中。恢复后，成员用原账号重登，按群权限查看历史，并重新确认云私聊及群云授权。个人 AI 保留编号和已入群状态，先由主人从「我的群 AI」重连，再由各成员自行同意。

按写入快照中最新授权的数据版本选择配套的 `backup.cjs --prepare-restore`，并使用该配套服务恢复。旧服务临时接管同一库时，仍按最新授权的写入版本选工具。以下历史结论按各自快照和功能范围适用。

- 确认只由 1.0.21.0 写过的库，可用 1.0.21.0 的工具准备。
- 仅在已验的 1.0.23.0 与 1.0.21.0 两版范围内，1.0.23.0 写过的库应使用 1.0.23.0 的 `backup.cjs --prepare-restore`，即使后来由 1.0.21.0 临时接管并继续收发。1.0.21.0 的工具不会清除照片授权（`image_ai_permissions`），不会使待处理看图轮次（`ai_image_turns`）失效，也不会关闭会话网页搜索（`ai_web_search_settings`）。
- 由 1.0.24.0 写过的快照，已验证使用同一冻结的 1.0.24.0 服务所带的 `backup.cjs --prepare-restore` 生成恢复副本，再由该 1.0.24.0 服务启动。1.0.24.0 降版恢复仍待验，1.0.21.0 与 1.0.23.0 的应急回退结论仅适用于原范围。
- 1.0.25.0 同版灾备已验证旧登录失效和原群成员权限恢复。1.0.27.0 同版灾备已验证快照内反馈和运营待答队列的恢复，以及旧标签须重登。
- 由支持三角色好友申请及主动联系的版本写过新授权时，选写入这些授权的配套工具。合流版同版恢复会清除全角色的好友申请意愿并关闭时段主动联系。旧 1.0.27.0 工具可清除该版兼容格式的三角色好友申请意愿，这项兼容核对仅覆盖好友申请。
- 库的版本来历不明时，先核对部署记录与快照来源，再选择工具。核对和恢复检查完成后才开放服务。

将下方示例中的 `restore_release` 设为按上述规则核对过的固定发布目录。原快照保持原样。恢复副本会清除所有旧登录会话，所有设备都须用原账号和密码重新登录。AI 私聊默认关闭，群内各账号按角色及服务保存的发送和上一问一答授权也会清除。群主若要继续使用自选群角色卡及书条目，须重新选卡并保存。用户可重新同意，原账号、好友关系、群成员和历史均保留。普通备份、正常同库升级、临时应急回退和重启均不执行这项灾备清理。

```sh
state=/var/lib/agent-arcade-social
restore_release=/opt/agent-arcade-social/releases/1.0.39.0
sudo -u agent-arcade-social /usr/local/bin/node \
  "$restore_release/social/deploy/backup.cjs" --prepare-restore \
  "$state/backups/BACKUP_ID/social.sqlite" "$state/backups/restore-$(date -u +%Y%m%dT%H%M%SZ)"
```

命令成功后再停止 `agent-arcade-social`，把当前 `social.sqlite` 及同名的 `-wal`、`-shm`（若存在）一起移到新的私有保全目录。将命令输出的恢复副本安装回状态目录，属主设为 `agent-arcade-social`、权限设为 `0600`。按上文确认的服务版本启动，用测试号检查旧会话已失效、重登后历史可读，并核对云聊天、群卡、照片授权与网页搜索状态。1.0.24.0 同版灾备保留快照中的举报回执和处置状态。快照之后的消息、举报及处置不在该副本中，已移除内容可能按快照状态重新出现。开放流量前，在隔离的恢复副本上将 `SOCIAL_DB` 指向该库。对快照之后的移除处置，先用 `node social/server/moderate.cjs show "<完整举报回执>"`，与原处置记录核对举报种类、账号、时间和被举报内容。仅当完整回执及对象一致且仍待审时，才以同一回执执行 `remove`，随后再用 `show` 核实；缺回执、有差异或已有其他处置时交运营复核。数字消息号在恢复后可能被新消息复用，禁止仅凭该号码重新处置。[举报处理](../README.md#举报处理)

### 应急回退

**.39 → .37 → .39 实包已验。** 日常及切换前保全使用上方普通一致性备份，不加 --prepare-restore，以保留现有登录和授权。每次先停原服务，再换版本；两次启动均让 SOCIAL_DB 指向同一份已验兼容的当前工作库。切回前备份 .37 实际写入的库。回退期间的新文字、PNG 和 WAV 随该库保留；若改用升级前快照，后续写入不在其中。.37 不提供个人 AI；回 .39 后主人重连原编号，原已撤销授权仍关闭。应急真人收发沿用下文关闭外部服务的操作。

如需回退到只记录首次同意的旧服务，保留当前数据库并先停止服务，在旧服务配置中去掉 `SOCIAL_DEEPSEEK_KEY`、`SOCIAL_OPENAI_KEY` 和 `SOCIAL_ANTHROPIC_KEY` 后才启动。这个回退可用于真人社交和读历史。数据库也会拦下旧服务为已关闭会话写入的云任务，即使误留了云配置。旧界面不认识关闭状态，尝试发送时可能只显示通用错误。需要继续提供 AI 私聊时，使用支持撤回和重新授权的版本。

**1.0.23.0 → 1.0.21.0 应急回退。** 仅验过这两版好友服务的真人私聊、群聊文字和原图。先停服，把当前 SQLite 库及同名的 WAL、SHM（若存在）一并保全到私有目录，用上面的普通备份命令生成一致性工作副本。旧服务使用独立环境文件，让 `SOCIAL_DB` 指向工作副本，留存保全件。移除模型、绘图、语音等外部服务配置，关闭主动联系和其他外部服务，再切到 1.0.21.0 启动，用两个测试账号核对文字收发和原图。切回 1.0.23.0 前先停旧服务，备份回退期间实际使用的工作库。新版须读取这份含回退期间新增消息和原图的库，再核对两个阶段的内容。直接使用升级前的备份会丢失备份之后新增的消息和原图。

聊天原图和消息一并事务写入同一个 SQLite 库，在线快照也会包含原图字节。恢复后用合成测试号打开一张已知图片核对。按附图后的数据库体积安排磁盘与快照保留期。

贴图沿用原图权限和快照范围。已同意的 AI 私聊或群内接话可回一张随版角色贴图或带署名的公开表情图。服务端公开图源是固定版本 OpenMoji 和 Wikimedia Commons。向图源发送的是公开目录、素材请求或经过筛选的公开主题词。模型只处理获准的文字，明确要求纯文字时只回文字。

服务 ZIP 中的 `social/server/public-reactions.cjs` 和 `src/bot/qq-public-lookup.cjs` 提供图源请求、筛选和署名，在线素材从对应图源获取，接收端可在原图详情查看作者、来源和许可。机器人和真人同在的群里也可发送照片及录音。录音与照片随数据库备份保存，访问沿用会话权限。上传附件和把附件原件地址发到群里都不会启动模型或公开图查找。

## 验收

本机演练需要 Node、Caddy、OpenSSL，以及一个尚未创建的输出目录。命令只启动回环监听，证书仅在演练请求中信任。通过后输出 `receipt.json`，覆盖两份独立会话、进程重启、在线快照和恢复副本。

```sh
node social/deploy/rehearse.cjs /path/to/caddy /path/to/openssl /path/to/new-rehearsal-output
```

正式公网验收使用授权 HTTPS 域名。先从另一条网络检查 `/healthz` 返回 `{"ok":true}`、首页能加载且证书可由客户端默认信任。然后用两台处于不同网络的客户端和两个合成账号互搜、接受好友申请、双向私聊，并通过群聊收件一次。服务重启后重新登录，核对好友与消息仍在，再将同一个 HTTPS origin 交给商店打包组。只有实际跨网络验收通过后才标记公网已通。公测试用前还需有运营方的举报处理与联系入口。

## 公开隐私说明与 Store 提交

同一服务公开提供 `/privacy.html`，无需登录即可只读查看。注册前和「我」页均有「隐私说明」入口。正式发布前由实际运营者落实以下项目：

在 Windows 好友页面可以复制公布的联系方式，也可以点公开 HTTPS 地址的「打开支持网页」，由系统默认浏览器打开。该动作需要同时部署支持此功能的好友壳和服务端。普通浏览器还提供直接撰写邮件的链接。

- 以获授权的实际 HTTPS 域名提供页面；最终 URL 是该真实域名下的 `/privacy.html`。把实际可访问的完整 URL 填入 Partner Center 的隐私政策字段，并从未登录、外部网络和 Windows 应用内检查。示例域名、本机和回环地址仅供部署演练。
- 在 `/etc/agent-arcade-social/service.env` 同时填写 `SOCIAL_PUBLIC_OPERATOR_NAME`（对外公布的运营名称）和 `SOCIAL_PUBLIC_PRIVACY_CONTACT`（公开支持邮箱或不含登录凭据的 HTTPS 地址），重启社交服务后从未登录的浏览器打开 `/privacy.html` 核对显示和链接。两个字段会直接公开，请使用正式联系信息。两项都不设置时，页面会显示尚未公布联系方式；只填一项或格式无效时服务会在启动时报错。回环环境可以完全省略。
- 确认实际联系入口能处理访问、更正或删除请求，并在公开说明中据实补齐数据库、备份、日志、数据保留与第三方处理做法。配置联系信息本身不代表上线或商店审核完成。
- 微软 Store 10.5 要求说明个人信息的用途、存储、保护、披露和访问控制；条款适用的第三方分享要取得明确同意并提供在产品中撤回的机制。AI 私聊顶部可关闭云聊天，并在明确同意后恢复。群成员可在「群成员 → 群内 AI」分别同意或撤回自己对鲸鱼娘（DeepSeek）和龙娘（OpenAI GPT）的授权。运营者和发布负责人须核对正式域名、公开说明和实际数据处理。对应服务没有配置密钥时，该角色不可用。回环演练只覆盖本机功能。 [Microsoft Store 10.5](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#105-personal-information)
