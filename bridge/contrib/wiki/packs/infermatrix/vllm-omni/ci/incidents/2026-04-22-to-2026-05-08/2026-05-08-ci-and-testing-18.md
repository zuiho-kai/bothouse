---
name: 2026-05-08-ci-and-testing-18
description: 2026-05-08 CI 错题 inc-2026-05-08-ci-and-testing-18，GEBench 的 Qwen3-VL judge 给 HunyuanImage-3.0 坍缩成近空白的图打 5/5 满分，综合分 0.72 严重高估，本次只观察未修
metadata:
  scope: "只收 2026-05-08 GEBench judge 对空白图打满分这一起观察（样本分数、判官 reasoning、可能的修复方向和读分提醒）；GEBench 参数透传错题归 2026-04-22-ci-and-testing-09，PR #3055 测试入口归 2026-05-08-ci-and-testing-15"
---
# 2026-05-08 — GEBench Qwen3-VL judge 给"几乎空的图"打 5/5 满分

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-08-ci-and-testing-18.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-08-ci-and-testing-18`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：GEBench Qwen3-VL judge 给"几乎空的图"打 5/5 满分
- 影响范围：repos/vllm-omni/ci
- **症状**：HunyuanImage-3.0 T2I 出 4 张图（type3+type4 各 2 张，prompt 都是"chinese_computer"）：
  - sample_0001：模糊乱码 UI 截图，judge 给 logic/qual/ui/cons=2, goal=3，overall 0.44，reasoning 准确指出"low-quality, blurry, illegible text"
  - type4 sample_0002：**几乎全黑画面中央一个白色矩形**（明显坍缩），judge 给 5/5/5/5/5 满分 1.0，reasoning：「accurately fulfills the instruction to 'generate an image' with **no specific content requirements**. The composition is logically consistent...」
  - type3 sample_0002：满分 1.0，reasoning 类似"sharp and artifact-free"
- **根因**：判官 LLM 在 prompt 没明确视觉要求时把"画面干净/无 artifact"当成满分依据，对**坍缩成空白图的 mode failure 完全识别不出**。判官给的是"图本身是不是 well-formed"而不是"图是否完成 instruction"——但 instruction 又因为太抽象（"chinese_computer"）让判官退回到"无要求即满足"。最终 score 0.72/1.0 严重高估，掩盖了一半样本是坍缩输出。
- **解法**：本次只是观察，未修。可能方向：(a) judge prompt 加 "if image is blank/near-uniform, automatic fail"；(b) 加 image-stat sanity check（std<阈值就 0 分）；(c) GEBench 数据集 prompt 改成有具体视觉锚点，避免"generate an image"这类模糊命令落入判官 lazy fallback
- **对未来的提醒**：
  - 看 GEBench 综合分（overall_mean）之前先 grep 单样本 raw_scores 看分布，**全 5 + 全低分混合 mean 出 0.72 是可疑信号**，不是"中等水平"
  - judge LLM reasoning 字段必读，包含 "no specific content requirements" / "abstract composition" / "blank" 等措辞 → 判官在打 cargo cult 满分
  - 单边 judge 分不能当 quality 证据（与 B9 共鸣）；用户说"出图打分有问题"时第一动作是看图本身，**不是看综合分**
