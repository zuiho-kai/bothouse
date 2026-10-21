# 自托管 CI（Issue #215）

四项 CoNest checks 使用标签 [self-hosted, linux, x64, conest-ci]，由 GitHub Actions 调度和回传检查结果。bridge、companion 门禁名称和测试保留；不以本地状态冒充 CI 成功。runner 离线时任务会排队，不能据此合并。

## 环境与边界

Windows 11 的独立 WSL2 Ubuntu 24.04 发行版 conest-ci，两个 runner 分别使用无 sudo 用户 runner、runner2。原 Ubuntu-22.04 运行 GPU 闸门，不修改或终止。独立发行版不挂载 Windows 盘、关闭 Windows 互操作；这不等于网络隔离，当前仅用于私有仓库的可信协作者，不适用于任意公开 fork 的代码。

runner 注册在本仓库，名称 conest-win11-wsl、conest-win11-wsl-2；目录分别为 /home/runner/actions-runner、/home/runner2/actions-runner，各自 HOME 权限700。凭据仅存在各自目录，不复制个人 GitHub 登录、模型配置或机器人会话。注册用一小时 token，通过标准输入传递，不入库/日志。

每个服务 CPUQuota=400%、MemoryHigh=5G、MemoryMax=6G、Nice=10；工作流 GOMAXPROCS=4。两项 job 可同时执行，不同 PR 也共享这两个名额，无需修改现有 job 依赖。两路合计上限8个逻辑线程算力、12GiB内存，是按需使用上限，不是独占预留。实机 Ryzen9 6900HX 为8核16线程，内存约32GiB，WSL当前可用约15GiB。WSL 仍与原发行版共享宿主资源，真实验收要同时确认闸门存活。

## 系统准备

新发行版安装 ca-certificates、curl、git、jq、build-essential、cmake、ffmpeg、python3、python3-venv、libicu74、libssl3t64、libkrb5-3、zlib1g、unzip、xz-utils。软件包只在准备阶段由管理员安装；CI job 不需要 sudo，ffmpeg 缺失就失败，不能跳过端到端素材测试后报绿。

Python 3.11、Node 22 和 go.mod 指定的 Go 由固定 SHA 的 setup actions 安装；工具缓存分别为 /opt/actions-toolcache、/opt/actions-toolcache-2，由对应用户拥有，服务分别设置 AGENT_TOOLSDIRECTORY 指向它。工作区、HOME和工具缓存分开，避免并行安装同一工具造成冲突。Python/Go 的项目锁文件和原测试命令保持。

初次从 GitHub 仓库 runners/downloads API 获取 Linux x64 下载地址与 SHA256，下载后校验再解包。初装 runner 2.337.0，归档 SHA256 70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613；保留官方自动更新能力。使用 config.sh --unattended 注册到本仓库，添加 conest-ci 标签，以 runner 用户运行。配置完成后由 root 执行 svc.sh install runner，给创建的 service 增加上述资源限制，再启动。

/etc/wsl.conf：

~~~ini
[boot]
systemd=true
[automount]
enabled=false
[interop]
enabled=false
appendWindowsPath=false
~~~

这些设置在新发行版开始执行任何 CI 前应用。需要重新加载时只终止 conest-ci，不能执行全局 wsl --shutdown。不要在任务运行时终止发行版或停止服务。

## 启动、维护和验收

Windows 登录时由名为 CoNest-CI-WSL 的计划任务启动 conest-ci 内的长驻 sleep，systemd 随发行版拉起 runner 服务。开机但未登录、断电、网络中断或 Windows 睡眠都会影响可用性；不修改用户现有电源策略。计划任务安装状态与实际验证结果见对应 PR/运行交接。

2026-10-21 实测：两个 runner 在线，Actions run 39546540674 的四项检查全部通过，并观察到两项 job 同时执行。两项 systemd 服务已启用，登录任务处于运行状态；尚未重启验证。当前电源策略为插电不休眠/不休眠到磁盘，电池供电4分钟睡眠、60分钟休眠到磁盘；合盖行为未验证。账单 Usage 页面未核对。仅 ci.yml 迁移，release.yml 和 ui-preview.yml 仍使用官方 runner。

只读检查：

~~~powershell
wsl -d conest-ci -u root -- systemctl status 'actions.runner.*'
wsl -d conest-ci -u runner -- /bin/bash -c 'findmnt -t drvfs; id'
schtasks /Query /TN CoNest-CI-WSL /V /FO LIST
~~~

GitHub 仓库 Settings → Actions → Runners 应显示两台 Online；实际任务详情必须显示 conest-win11-wsl 或 conest-win11-wsl-2，测试步骤真实执行，最新提交的四项检查全部通过。账户账单限制是否影响自托管调度，以这次真实运行验证为准。环境安装成功不代表门禁已通过。

Windows 内的代码工作区、工具缓存、日志会积累；不配置自动批量删除，空间不足先通知主人处理。退回云端需通过 PR 将 runs-on 改回 ubuntu-latest，并恢复素材 job 的依赖安装；必须先确认云端账单恢复，不关闭合并门禁。
