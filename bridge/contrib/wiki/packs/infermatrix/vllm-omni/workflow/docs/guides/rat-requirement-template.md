---
name: rat-requirement-template
description: "vLLM-Omni RAT 需求文档模板（归档自 vllm-omni-project-manage issue #66）：需求名称、Why/Who/What/When/How 格式化描述、规格与约束、工作量、需求定位、周边依赖、评审结论"
metadata:
  scope: 只收提交或评审 RAT 需求的模板及使用说明；已基线需求的变更申请用 ccb-change-request-template，生成文档与支持声明规则归 generation-and-support-rules，目录分流归 docs-guides-overview
---
# vLLM-Omni RAT 需求文档模板

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/guides/rat-requirement-template.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, docs, planning；created: 2026-08-06；updated: 2026-09-07
- 来源（sources）：https://github.com/JiusiServe/vllm-omni-project-manage/issues/66
- **何时使用**：提交或评审 vLLM-Omni RAT 需求时，用本页确认需求背景、客户诉求、交付时间、工作量、规格约束和周边依赖均已明确。
- 本页归档自 [vllm-omni-project-manage issue #66](https://github.com/JiusiServe/vllm-omni-project-manage/issues/66)。下方保留原模板的字段和示例语义；使用时替换所有占位内容，并在评审完成后填写评审结论。

### 模板

````markdown
### 需求名称

（示例：【xxLHS】xx提供日志归档、监控指标采集功能，配合EI对接xx运维监控、计费管理）

### 需求描述（格式化描述）

【需求背景和价值】--Why

1. 需求背景：（示例：xx组件部署在数据面，对于xx集群中无法自动恢复的故障需要上报告警信息，通知 Fabrics 的 SRE，通过人工干预的方式进行恢复）；
2. 需求价值：（示例：支撑 LHS 1230 商用上线）。

【目标客户】--Who and Where

（示例：xx EI - LakeHouse Service，xx贵阳 202 局点）

【客户诉求】--What

（示例：

1. xx集群中无法自愈的故障，需要上报告警信息，通过人工干预方式恢复集群的运行；
2. xx SDK、runtime 打印的日志提供滚动压缩和老化删除能力，防止日志过大或过多，占用磁盘空间，导致集群无法正常工作；
3. DWS 中xx计算引擎需要获取xx集群中可用资源信息，用于决策启动 DN 函数实例 range 最大函数实例范围。）

【交付时间】--When

（示例：2024/12/30：乌兰一、贵阳 202、北京四、新加坡 Region 商用上线）

【需求描述】--How and How many work

（示例：

1. AR1：xx集群中无法自愈的故障，需要上报告警信息；-1 人月
2. AR2：用户函数日志支持滚动和 runtime 日志支持老化删除；-0.5 人月）

【需求规格和约束】--How Much

默认都涉及，若不涉及需单独说明。

1. 规格指标要求（包括但不限于性能、可靠性等）：
   （示例：支持的卡型号、模型、输入规格（图像大小张数、视频分辨率长度、文本输入长度、音频长度）、输出规格、并发支持、性能指标 SLO（RTF、TTFT、TPOT、吞吐））
2. 约束（整个需求存在哪些约束条件）：
   （示例：无）

【工作量】

（示例：1.5 人月）

【需求定位】

（示例：商用）

【周边依赖】

（示例：依赖 MindIE-SD xxx 版本 xxxx 特性）

### 评审结论

（示例：vLLM-Omni 0.28 版本接纳该需求，1.5 人月工作量纳入项目人力管道）
````

### 相关知识

- 需要把需求继续收敛为开发前规格时，使用 Canonical Mini Spec（源链接 `../../../../general/planning/guides/mini-spec.md`）。
- 需要核验公开文档、支持声明或生成内容时，查看 [[generation-and-support-rules]]（generation and support rules）。
