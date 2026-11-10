---
name: 2026-04-21-remote-ssh-slurm-container-01
description: 2026-04-21 远端错题，假设路径导致 docker exec 失败、挂载为空、HF 缓存丢失；侦察三连与持久 HF_HOME 提醒
metadata:
  scope: 只收 2026-04-21「假设路径 + HF 缓存丢失」这一次事故的症状、根因、侦察命令和提醒；容器搭建流程归 container-setup
---
# 2026-04-21 — 假设路径 + HF 缓存丢失

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-21-remote-ssh-slurm-container-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-21-remote-ssh-slurm-container-01`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：假设路径 + HF 缓存丢失
- 影响范围：general/remote
- 原文件说明：源页在 `## 原文件说明` 下以 `# Error Book: 远端 SSH / Slurm / 容器基础` 为题收录本条

## 决策与踩坑

### 2026-04-21 — 假设路径 + HF 缓存丢失

- **症状**：docker exec 失败、挂载路径为空、HF 缓存消失
- **根因**：不同节点布局不同；容器内 `~` 在容器层，非持久
- **侦察三连**：

```bash
docker ps && docker inspect <container> --format '{{range .Mounts}}...'
find <AUTHORIZED_MOUNT_ROOT> -maxdepth 5 -name "snapshots" -type d 2>/dev/null
env | grep -iE "cache|hf_home"
```

- **提醒**：建容器挂 `/home`，`HF_HOME` 指向持久路径
