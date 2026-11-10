---
name: user-visible-acceptance
description: User-visible Acceptance Gate：用户可见改动的验收门禁，含触发条件、五条硬规则、开工前与交付前的执行模板、2026-06-24 Greyfield Next 来源
metadata:
  scope: 只收用户/reviewer/CI reader 可见改动的框架级验收门禁；具体项目命令和 artifact 路径归各项目规则
---
# User-visible Acceptance Gate

## 现状

- 这条是框架规则，不绑定某个项目。
- 只要改动会被用户、reviewer、CI reader 或最终产品用户直接看到，就不能把“代码路径通过”当成验收完成。

## 关键事实

- 源页：`knowledge/general/docs/guides/user-visible-acceptance.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, docs；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 触发条件

- 以下任一类改动都触发本门禁：
  - 前端 / UI / 桌面窗口 / 设置页 / 交互状态 / 动画 / 截图。
  - CLI 输出、错误信息、状态文本、README / PR body / reviewer-facing comment。
  - benchmark / profiling / accuracy 报告、表格、图、artifact、可视化截图。
  - 用户或 reviewer 明确说“我手工看到了问题 / 这不可用 / 这个说明不对”。

### 硬规则

1. **普通用户路径先于内部捷径**
   - 验收必须从用户实际会做的点击、输入、命令、配置、PR 阅读路径出发。
   - 禁止只用内部字符串、直接 IPC、mock-only 单测、底层函数成功或局部 DOM 存在来证明用户路径可用。
2. **agent 是第一道 QA**
   - 交给用户前，agent 必须自己打开当前输出：应用截图、CLI 输出、PR body 渲染、benchmark result、trace summary 或 artifact。
   - 不能把“肉眼看是否溢出 / 是否遮挡 / 是否读得懂 / 是否和实际行为一致”丢给用户做第一轮。
3. **产品形态是 blocker**
   - 对 UI：检查文本/控件溢出、旧样式残留、状态和行为不一致、动画/生命周期缺失、遮挡核心内容、透明/点击穿透等产品形态问题。
   - 对报告/PR：检查 stale head、旧证据、不能公开的本地/远端细节、指标口径不清、artifact provenance 不一致。
   - 这些问题即使单测绿，也按阻塞处理。
4. **漏检必须补最近的守护**
   - 用户手工抓到一次用户可见 bug，修复不算完成，直到同一分支补上最近的 harness / check / screenshot review requirement / PR gate。
   - 如果无法自动化，必须把人工 review artifact 和检查清单写进 repo 规则或 PR gate，而不是只在聊天里承诺。
5. **项目命令下沉到项目**
   - 本页只定义框架门禁。具体命令和 artifact 路径由项目规则定义。
   - 例如 Greyfield Next 用 `pnpm harness:frontend-full` 和 visual artifacts；vLLM-Omni 性能/模型 PR 用对应 benchmark/profiling/PR body provenance gate。

### 执行模板

- 开工前写清：

```text
User-visible acceptance:
- Ordinary user path:
- Current output/artifact I will inspect:
- Automated guard to add/update:
- Final command/gate:
```

- 交付前至少回答：

```text
I inspected the current user-visible output/artifact: <path or command output>.
The guard that would catch this next time is: <test/harness/check/manual gate>.
```

## 决策与踩坑

### 来源

- 2026-06-24，Greyfield Next 中连续出现 Settings 普通用户路径仍走 fake provider、Chat 页面旧 CSS 背景块、桌宠气泡位置/淡出生命周期等问题。
- 程序性 harness 绿，但用户手工 QA 才发现产品形态不可接受。
- 教训不是 Greyfield 专属：任何用户可见行为都需要普通用户路径和当前输出验收。
