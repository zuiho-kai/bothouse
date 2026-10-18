# 代码来源

CoNest（共栖）将已有桥接和产品扩展集中到一个仓库，不代表所有代码由本项目原创。

| 目录 | 来源与基线 | 本次处理 |
| --- | --- | --- |
| bridge/ | zuiho-kai/cc-connect 的 maomao，8b27736e5b6f2dba61bc0cfb2d5397b73224156c；其 Go module 为 github.com/chenhg5/cc-connect | 保留 Git 祖先历史，移入子目录，包含本机后续桥接补丁 |
| companion/ | Zssan12/yijiazi，b408538ab1428604c93827928b24971ff9b00a5b 之后的本地语音、活动、日报实现 | 导入当前相关源码和测试；旧网页 demo 留在原仓库 |
| skills/ | 同一产品开发阶段的项目协作技能 | 纳入产品工作流 |
| prototypes/device-ui/ | 本项目对话中的 UI 草图；Codex visualize 1.0.50 独立导出外壳；角色引用 fywdy/chatgpt-chibi-pets 固定版本 | 保留可编辑片段与独立预览；美术为 CC BY-NC 4.0，未导入图集二进制，详见[原型来源与边界](prototypes/device-ui/README.md#素材来源)及原始 NOTICE |

2026-10-18 补充：[角色视频素材](prototypes/device-ui/assets/characters/README.md)由用户提供，基于参考角色生成，按可见动作重命名导入14段原始视频及抽帧预览；保留fywdy署名、非官方声明和CC BY-NC 4.0美术约束，具体工具与提示词记录未齐。原始图集二进制仍未导入。

上游的 README、贡献者说明和文件内归属保留在 bridge/。Go module 路径和 CLI 名称 cc-connect 暂时保留，避免为了品牌重命名破坏导入和运行兼容性。

桥接快照的 README 声明 MIT，但此次快照没有独立 LICENSE 文件；本项目未臆造版权人、年份或统一许可。公开发布前需补齐可核实的许可文本与项目新增部分的授权。见 [Issue #9](https://github.com/Zssan12/conest/issues/9)。

本仓库不包含实际 Discord token、CLI 登录态、会话正文、语音录音、模型权重和运行配置。历史部署仍在原工作目录；源码整合不等于运行迁移。
