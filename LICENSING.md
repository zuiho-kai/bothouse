# 许可说明

CoNest（共栖）按层使用不同许可。本页说明每个目录适用什么许可、哪些内容不在本项目授权范围内，以及上游代码的许可声明。目录来源见 [SOURCE_ORIGINS.md](SOURCE_ORIGINS.md)。

## 一句话

- 平台层：[AGPL-3.0](LICENSE)。
- 适配器层（接 Claude Code、Codex、OpenClaw、DSH 等智能体的代码）：[Apache-2.0](LICENSES/Apache-2.0.txt)。
- 固件：不在本仓库。
- 第三方代码和素材：保留各自原许可，本项目不对它们重新授权。

除非某个文件或目录另有声明，本仓库中 CoNest 新增的内容按下表授权。

## 目录许可表

| 目录 | 层 | CoNest 新增部分的许可 | 其中的第三方内容 |
| --- | --- | --- | --- |
| `bridge/`（除 `bridge/agent/`） | 平台层 | AGPL-3.0 | 上游 cc-connect（chenhg5/cc-connect，经 zuiho-kai/cc-connect 的 maomao 分支）为 MIT，正文见 `bridge/LICENSE-MIT-upstream`；`bridge/assets/sponsors/`、`bridge/assets/banners/`、`bridge/docs/images/sponsors/` 中的标识归各自所有者，不随本仓库授权 |
| `bridge/agent/` | 适配器层 | Apache-2.0 | 同上，上游部分保留 MIT |
| `integrations/` | 适配器层 | Apache-2.0 | 无 |
| `companion/` | 平台层 | AGPL-3.0 | 来自 Zssan12/yijiazi，权利人与本仓库所有者相同 |
| `role-household/` | 平台层 | AGPL-3.0 | 无 |
| `prototypes/device-ui/`（代码） | 平台层 | AGPL-3.0 | Codex visualize 导出外壳，见该目录 README |
| 固件（`firmware/`、`role-household/firmware-xiaozhi/`）、角色头像（`role-household/avatars/`）、圆屏原型素材和截图（`prototypes/device-ui/assets/`、`preview.png`、`test-artifacts/`） | — | 不在本仓库 | 固件不在本仓库。素材含授权未核实的头像和 CC BY-NC 4.0 美术，不随本仓库授权 |
| `docs/` | 文档 | AGPL-3.0 | 无 |
| `experiments/` | 平台层 | AGPL-3.0 | 运行时下载的模型和权重不在仓库内，按各自许可 |
| `skills/` | 适配器层 | Apache-2.0 | 无 |
| 根目录文件、`.github/` | 平台层 | AGPL-3.0 | 无 |

## 上游 MIT

CoNest 是接入 [cc-connect](https://github.com/chenhg5/cc-connect)、DSH 等平台的插件。为了一条命令就能装好，`bridge/` 随附了一份 cc-connect（MIT），CoNest 的插件代码和它放在一起分发，直接来源是 [zuiho-kai/cc-connect](https://github.com/zuiho-kai/cc-connect) 的 maomao 分支。随附的 cc-connect 代码仍按 MIT 使用，上表的 AGPL-3.0 / Apache-2.0 只针对 CoNest 新增的部分。

上游在 `bridge/README.md` 和 `bridge/npm/package.json` 中声明 MIT，但原先没有 LICENSE 文件。2026-10-21 已在 zuiho-kai/cc-connect 补上 MIT 正文（[zuiho-kai/cc-connect#1](https://github.com/zuiho-kai/cc-connect/pull/1)，合并提交 cd376899），[bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream) 是该文件的原样副本。chenhg5/cc-connect 本身仍没有 LICENSE 文件。上游代码的作者署名通过保留的 Git 历史和文件内归属保留。

## AGPLv3 第 7 条附加条款

修改版须保留署名 `Built on CoNest` 和原项目链接 https://github.com/zuiho-kai/conest ，有界面的放在关于、法律、页脚或署名位置，并按第 7(c) 条标出改动。全文见 [NOTICE](NOTICE)。网页控制台的页脚（`bridge/web/src/components/Layout/Footer.tsx`）已带这条署名。

## 依赖

依赖按各自许可使用，不随本仓库重新授权，直接依赖的许可见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。例如 `maunium.net/go/mautrix` 为 MPL-2.0。

## 贡献

贡献需在每个提交中签署 DCO（`Signed-off-by`），见 [CONTRIBUTING.md](CONTRIBUTING.md#贡献签署dco) 和 [DCO](DCO)。
