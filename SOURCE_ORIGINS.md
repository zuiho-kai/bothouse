# 代码来源

CoNest（共栖）将已有桥接和产品扩展集中到一个仓库，不代表所有代码由本项目原创。

| 目录 | 来源与基线 | 本次处理 |
| --- | --- | --- |
| bridge/ | zuiho-kai/cc-connect 的 maomao，8b27736e5b6f2dba61bc0cfb2d5397b73224156c；其 Go module 为 github.com/chenhg5/cc-connect | 保留 Git 祖先历史，移入子目录，包含本机后续桥接补丁 |
| companion/ | Zssan12/yijiazi，b408538ab1428604c93827928b24971ff9b00a5b 之后的本地语音、活动、日报实现 | 导入当前相关源码和测试；旧网页 demo 留在原仓库 |
| skills/ | 同一产品开发阶段的项目协作技能 | 纳入产品工作流 |
| integrations/dsh-acp-stream/ | DeepSeek Harness（MIT）本机 steer 基线 ecc89fff43a85d7f836a99472dd31e672fd89c26 | 源码补丁、测试与文档，保留 MIT 许可，不随附运行凭据 |

#284 的语音转发原型来自 CoNest PR #228 的 2cfe70cd1e551c6e96296d3a66b421a9d257ffa9，迁移时保留 bothouse 当前的语音总台与 user_text。远程 ASR 客户端、服务工具及诊断来自 CoNest main e504a05b50a9a6fa9c7680e768c5b38fe2ff6d4b，用于保持本地现有硬件识别配置兼容。

项目自有代码（包括 `companion/`）按 Apache-2.0 授权；上游组件与第三方依赖仍按各自许可使用，详见 [LICENSING.md](LICENSING.md)。

2026-10-18 补充的角色视频素材（CC BY-NC 4.0 美术约束）不随公开仓库发布。

上游的 README、贡献者说明和文件内归属保留在 bridge/。Go module 路径和 CLI 名称 cc-connect 暂时保留，避免为了品牌重命名破坏导入和运行兼容性。

上游项目 [chenhg5/cc-connect](https://github.com/chenhg5/cc-connect) 的 README 声明 MIT，但仓库根目录没有 LICENSE 文件；本仓库 `bridge/` 中该来源代码的许可依据是这一 README 声明。zuiho-kai/cc-connect 的 maomao fork 后来补充了 MIT LICENSE（[zuiho-kai/cc-connect#1](https://github.com/zuiho-kai/cc-connect/pull/1)，版权行 `Copyright (c) chenhg5 and cc-connect contributors`），其原样副本保留在 `bridge/LICENSE-MIT-upstream`。保留的上游代码按其 MIT 声明使用；本项目自有代码的 Apache-2.0 授权见 [LICENSING.md](LICENSING.md)。

本仓库不包含实际 Discord token、CLI 登录态、会话正文、语音录音、模型权重和运行配置。历史部署仍在原工作目录；源码整合不等于运行迁移。
