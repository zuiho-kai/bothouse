---
name: packaging-deploy-rules
description: packaging-deploy 审查规则 JW-PKG-1a 至 1d：依赖上限解除与 uv.lock、分层业务镜像 BASE_IMAGE 与 uid/gid、Dockerfile.claw 构建参数与可选文件守卫、发行包更名 workswarm
metadata:
  scope: 只收 JW-PKG-1a 至 1d 四条审查规则；打包与部署的功能说明归 feature-deployment
---
# packaging-deploy 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7247；PR #7633；PR #7770；PR #7777
- 置信度（confidence）：high
- [JW-PKG-1a] 解除有兼容性说明的依赖上限前，核对调用方并同步锁文件
  - 触发：修改带有兼容性原因和解除条件的依赖约束；例如 dev-stable 的 `pyproject.toml` 中 `anthropic<1.0.0`。
  - 强制：核对约束旁注明的调用方兼容条件；放宽上限时提供实际客户端构造/请求的验证，并在同一改动重新生成 `uv.lock`（仓库规则 JIUWENSW-I3）。
  - 验收：依赖声明与锁文件一致；新的解析版本能通过项目实际模型客户端的兼容性验证。^[PR #7633]
- [JW-PKG-1b] 分层业务镜像必须保持基础镜像注入与部署身份一致
  - 触发：修改 feature/enterprise-verify 的 `docker/Dockerfile.claw`、`Dockerfile.sandbox`、`Dockerfile.web` 及其 base 镜像。
  - 强制：保持业务镜像的 `ARG BASE_IMAGE` / `FROM ${BASE_IMAGE}` 依赖；系统工具和 uv 由对应 base 层提供。app 用户显式固定 uid/gid 为 1000，与部署模板的运行身份一致；构建期依赖安装继续使用 uv。
  - 验收：传入所需 BASE_IMAGE 进行实际构建并核对容器内 app 的 uid/gid 与部署身份；改依赖时复核各层构建顺序。^[PR #7770]
- [JW-PKG-1c] 外部依赖构建参数和可选文件守卫必须分别验证
  - 触发：修改 feature/enterprise-verify 的 `docker/Dockerfile.claw` 外部 agent-core/runtime 安装或可选文件 sed/yq。
  - 强制：core/runtime 仓库和分支通过有默认值的对应 ARG 注入；移除主 dependencies 中的 openjiuwen 时只匹配目标条目，保留 harmony/extras 引用。对可能缺席的 EE pyproject 或 symphony extension.yaml 先检查文件存在，再执行变换。
  - 验收：显式给定有效 BASE_IMAGE，分别检查可选文件存在/缺席场景，以及主依赖删除后其他组的引用仍保留。^[PR #7777]
- [JW-PKG-1d] 发行包更名不能连带改写 Python 模块和 CLI 入口
  - 触发：修改安装、升级、卸载、包查询、extras 或 PyPI 徽章中的发行包名。
  - 强制：发行包命令和徽章使用 `workswarm`，如 `workswarm[a2a]`；保留 `jiuwenswarm` Python 模块及已声明的 CLI 入口，保留源码开发的 `uv sync --extra ...`。成对更新相关中英文说明。
  - 验收：核对 pyproject 的 distribution 与 entry points；安装命令、徽章和双语文档一致，删除产物后无悬空说明。^[PR #7247]

## 决策与踩坑

- [JW-PKG-1a] 禁止：只改版本范围而不核对自定义 HTTP client 的接受情况；把仓库注释中的第三方版本历史直接当作经过外部核验的 SDK 事实。
- [JW-PKG-1b] 禁止：在业务层重新引入不匹配的基础镜像或默默另分配 uid/gid；把 Dockerfile 文本变化当作镜像已经成功构建的证据。
- [JW-PKG-1c] 禁止：裸处理可选缺席文件；用宽泛删除误伤其他依赖组；把这些 ARG 的默认值误写为 BASE_IMAGE 也有默认值或无参数构建必定成功。
- [JW-PKG-1d] 禁止：继续新增 `pip install jiuwenswarm`；机械替换所有 jiuwenswarm 字符串而改坏模块名/命令；恢复已经下线的单独 TUI 安装段落。
