---
name: node-basics-2
description: 进陌生远端节点的正确流程（第 2/2 部分）：香港机器直连 PyPI 不用清华源及装包慢先换源的数据点、别人的 editable install 用自己的 worktree + PYTHONPATH 前置
metadata:
  scope: 只收香港节点的包源选择规则和共享 venv 里他人 editable install 的隔离套路（适用范围、反例）；陌生节点的环境侦察顺序归 node-basics-1
---
# 进陌生远端节点的正确流程（第 2/2 部分）

## 现状

- 本页是源页 `node-basics.md` 的第 2 节“香港机器：直连 PyPI，不要清华源”和第 3 节“别人的 editable install：worktree + PYTHONPATH 前置”；第 1 节“进陌生远端节点的正确流程”在 [[node-basics-1]]。

## 关键事实

- 源页：`knowledge/general/remote/guides/node-basics.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-16；sources: 无

### 2. 香港机器：直连 PyPI，不要清华源

#### 规则

- **默认 PyPI 直连**：`pypi.org` 连得很快
- **不要用清华源**：`pypi.tuna.tsinghua.edu.cn` 在香港机器上**反而慢**（香港 → 北京 → 清华 → 香港，反向绕路）
- **不要用阿里云源**：同理

#### 容器里 pip 配置可能是遗留

- `pip config list` 如果显示 `global.index-url='https://pypi.tuna.tsinghua.edu.cn/simple'`，那是镜像拉自国内集群的老配置遗留，**在香港节点上应当无视或覆盖**：

```bash
# 好：直连 pypi
uv pip install --index-strategy unsafe-best-match <pkg>
pip install --index-url https://pypi.org/simple <pkg>

# 坏：绕路清华
uv pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple <pkg>
pip install <pkg>  # 如果 pip.conf 是清华
```

#### 数据点

- 装 `mmengine`：清华源挂起 60+ 秒不动 → Ctrl-C；默认 pypi **3.82 秒** 装完
- 装 `open_clip_torch + clip-benchmark`（5 个包）：默认 pypi ~20 秒

#### 推论

- HF 下载同理，`hf download` 默认直连 `huggingface.co`，在香港直连最快，不要设镜像
- `apt install` 同理，默认 `archive.ubuntu.com` 或 docker image 预设的源通常 OK

### 3. 别人的 editable install：worktree + PYTHONPATH 前置

- 远端 `/rebase/.venv/bin/python` 这种共享 venv 里 vllm_omni 经常是别人活跃 checkout 的 editable install（典型在 `/mnt/scratch/wt-pr<n>/`），上面可能有别人 mid-edit 的脏文件，**不能直接 patch**。
- 更严格的边界：他人 repo/venv 默认只能只读侦察版本、依赖和 editable 指向；不要把新 worktree 挂到对方 repo 的 `.git/worktrees`，也不要用对方 venv 做安装或测试缓存写入。
- 真正验证用 owner root 下已确认的 repo/venv，或本轮专用 clone + 自有 venv/cache。

#### 套路

1. **建自己的干净 clone/worktree**：从任务 owner 的远端和自己有写权限的目录创建；他人的 editable install 只用于识别版本和依赖，不在其中 fetch、建 worktree 或修改文件
2. **SCP 自己的改动文件**：改了哪几个就 scp 哪几个进新 worktree 的相同相对路径（不要整目录 sync，否则把对方未 push 的状态也带过去）
3. **PYTHONPATH 前置**跑：
   ```bash
   PYTHONPATH=/mnt/scratch/wt-<my-feature>:$PYTHONPATH python -m pytest <test_path> -v
   ```
   Python 找包按 sys.path 顺序，前置自己的目录 → 我的 `vllm_omni/...` 模块文件先被找到，editable install 里的同名模块被屏蔽
4. **验证生效**：`python -c "import vllm_omni.X; print(vllm_omni.X.__file__)"` 必须打印自己 worktree 路径，不是 `/mnt/scratch/wt-pr<n>/...`

#### 适用范围

- 测试 Python 端纯逻辑改动（prompt 构造、schema、validator、DSL）
- 改动只涉及少数 .py 文件（≲10 个），SCP 还能控制
- **不适用**：动 C++ extension / kernel / 编译产物——editable install 的 .so 是另一份、PYTHONPATH 不解决 ABI
- **不适用**：改动牵动 setup.py / pyproject.toml / `__init__.py` 重导出顺序——可能需要重装

## 决策与踩坑

### 2. 香港机器：踩坑教训：装包慢先怀疑源，不要怀疑包

- **症状**：`uv pip install X` 卡 60 秒无输出，我以为是 uv 在解依赖
- **真相**：是 pypi.tuna 清华源在香港连接慢；切 pypi.org 3.82 秒完成
- **教训**：命令行装包不动，第一反应**换源**（pypi.org），不要去 Ctrl-C 然后换工具（pip vs uv）——**工具不是问题，源才是问题**

### 3. 别人的 editable install：反例（不要做）

- 直接 `vim /mnt/scratch/wt-pr<n>/vllm_omni/...` 改对方 working tree
- `pip install -e .` 自己的 worktree 覆盖对方的 editable
- rsync 整个本地 worktree 上去——会把本地未 commit 的脏文件、pyc 缓存、IDE 配置全推过去
