---
name: owners-rules
description: "OWN-1a：module frontmatter 的 owners / primary_code_paths 与 .github/CODEOWNERS 须保持可验证投影（edit-first source map、scoped additive overlay、last-match-wins、双向 parity，PR #5958）"
metadata:
  scope: 只收 source-tree ownership projection 的 OWN-1a 规则；模块 owner 表归 module_owner，模型 owner 表归 model_owner，官方设计文档地图归 design-doc-map，目录入口归 owners-overview
---
# Source-tree ownership projection rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/owners/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, review；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：.github/CODEOWNERS；docs/design/module/；PR #5958
- 只有 `OWN-数字字母` 是可审计规则 ID。本页维护 source-tree review routing；runtime 行为仍回对应 component/model owner，committer 身份与职责仍回 `docs/community/governance.md`。
- [OWN-1a] Module frontmatter 与 CODEOWNERS 必须保持可验证投影
  - 触发：修改 `docs/design/module/*.md` 的 `owners`、`primary_code_paths` 或 `primary_code_path_owners`，修改 `.github/CODEOWNERS` 的 `vllm_omni/**` rule，或新增跨模块 subtree/file override。
  - 强制：先编辑 module frontmatter 作为 edit-first source map，再同步 `.github/CODEOWNERS`；GitHub 自动 review 的执行权威仍是目标 pin 的 CODEOWNERS。`primary_code_path_owners` 是 scoped additive overlay，命中时必须与 module base owners 取并集。
    - CODEOWNERS 按 last-match-wins 排列 umbrella rule 在前、submodule/file override 在后，并用最终最具体的匹配路由 changed path。module 页的 `status: draft` 不妨碍 ownership 投影，也不把 candidate invariant 升级成 runtime 规范。^[PR #5958]
  - 验收：做双向 parity——每个 `primary_code_paths`/scoped overlay 都有对应 CODEOWNERS rule，反向每条声称来自 module doc 的 source-tree rule 也能回到 frontmatter；再用代表性路径模拟最终匹配，至少覆盖 catch-all、umbrella、subtree 和 file override。目标仓库当前没有自动 generator、parity checker 或 regression test，因此合入前必须保留人工双向检查证据；
    - PR prose 与目标文件冲突时按目标文件路由，并把治理意图差异交给 owner 确认。
- 相关导航：[[owners-overview]]（负责人索引）、[[design-doc-map]]（官方设计文档地图）。

## 决策与踩坑

- [OWN-1a] 禁止：只改 frontmatter 或 CODEOWNERS 一侧；让 scoped overlay 替换 base owners；从 module frontmatter 推断 docs/recipes/tests/CI/apps/out-of-tree benchmark 等直接维护的 CODEOWNERS section；或用 PR body/comment 的 owner 名单覆盖目标文件。没有生成器/checker 时，“已模拟若干路径”也不能充当持续 gate。
