# 许可说明

CoNest（共栖）按层使用不同许可。本页说明每个目录适用什么许可、哪些内容不在本项目授权范围内，以及怎样取得商业授权。目录来源见 [SOURCE_ORIGINS.md](SOURCE_ORIGINS.md)。

## 一句话

- 平台层：[AGPL-3.0](LICENSE)，另提供商业授权（双许可）。
- 适配器层（接 Claude Code、Codex、OpenClaw、DSH 等智能体的代码）：[Apache-2.0](LICENSES/Apache-2.0.txt)。
- 固件：众筹期不公开，首批发货日起以 GPL-3.0 公开。公开前，固件目录不随本仓库授权。
- 第三方代码和素材：保留各自原许可，本项目不对它们重新授权。

除非某个文件或目录另有声明，本仓库中 CoNest 新增的内容按下表授权。

## 目录许可表

| 目录 | 层 | CoNest 新增部分的许可 | 其中的第三方内容 |
| --- | --- | --- | --- |
| `bridge/`（除 `bridge/agent/`） | 平台层 | AGPL-3.0 或商业授权 | 上游 cc-connect（chenhg5/cc-connect，经 zuiho-kai/cc-connect 的 maomao 分支）为 MIT，正文见 `bridge/LICENSE-MIT-upstream`；`bridge/assets/sponsors/`、`bridge/assets/banners/`、`bridge/docs/images/sponsors/` 中的标识归各自所有者，不随本仓库授权 |
| `bridge/agent/` | 适配器层 | Apache-2.0 | 同上，上游部分保留 MIT |
| `integrations/` | 适配器层 | Apache-2.0 | 无 |
| `companion/` | 平台层 | AGPL-3.0 或商业授权 | 来自 Zssan12/yijiazi，权利人与本仓库所有者相同 |
| `role-household/`（除下面两项） | 平台层 | AGPL-3.0 或商业授权 | 无 |
| `role-household/avatars/` | 素材 | 不授权 | 角色头像授权未核实：同一套角色的其他头像记录为第三方角色的二次创作、原作不能商用；不随本仓库授权 |
| `role-household/firmware-xiaozhi/` | 固件 | 公开前不授权；公开后 GPL-3.0 | 对 [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32/blob/v2.5.2/LICENSE) v2.5.2 的补丁，上游为 MIT（Copyright (c) 2025 Shenzhen Xinzhi Future Technology Co., Ltd. 与 Project Contributors），上游部分保留 MIT |
| `firmware/` | 固件 | 公开前不授权；公开后 GPL-3.0 | 无 |
| `prototypes/device-ui/`（代码） | 平台层 | AGPL-3.0 或商业授权 | Codex visualize 导出外壳，见该目录 README |
| `prototypes/device-ui/assets/`、`preview.png`、`test-artifacts/` | 素材 | 不授权 | 角色美术来自 [fywdy/chatgpt-chibi-pets](https://github.com/fywdy/chatgpt-chibi-pets/tree/d5bbb27c79e5c08e8b8ab44d4023cd35a67418e2) 及其衍生视频和截图，按 CC BY-NC 4.0（禁止商用），见 [UPSTREAM-NOTICE.md](prototypes/device-ui/UPSTREAM-NOTICE.md)；商业授权不包含这些素材 |
| `docs/` | 文档 | AGPL-3.0 或商业授权 | 无 |
| `experiments/` | 平台层 | AGPL-3.0 或商业授权 | 运行时下载的模型和权重不在仓库内，按各自许可 |
| `skills/` | 适配器层 | Apache-2.0 | 无 |
| 根目录文件、`.github/` | 平台层 | AGPL-3.0 或商业授权 | 无 |

## 上游 MIT

`bridge/` 基于 cc-connect（[chenhg5/cc-connect](https://github.com/chenhg5/cc-connect)，MIT）开发，直接来源是 [zuiho-kai/cc-connect](https://github.com/zuiho-kai/cc-connect) 的 maomao 分支。上游在 `bridge/README.md` 和 `bridge/npm/package.json` 中声明 MIT，但原先没有 LICENSE 文件。2026-10-21 已在 zuiho-kai/cc-connect 补上 MIT 正文（[zuiho-kai/cc-connect#1](https://github.com/zuiho-kai/cc-connect/pull/1)，合并提交 cd376899），[bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream) 是该文件的原样副本。chenhg5/cc-connect 本身仍没有 LICENSE 文件。上游代码的作者署名通过保留的 Git 历史和文件内归属保留。

## AGPLv3 第 7 条附加条款

修改版须保留署名 `Built on CoNest` 和原项目链接 https://github.com/Zssan12/conest ，有界面的放在关于、法律、页脚或署名位置，并按第 7(c) 条标出改动。全文见 [NOTICE](NOTICE)。网页控制台的页脚（`bridge/web/src/components/Layout/Footer.tsx`）已带这条署名。

## 依赖

依赖按各自许可使用，不随本仓库重新授权，直接依赖的许可见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。例如 `maunium.net/go/mautrix` 为 MPL-2.0。

## 商业授权

如果 AGPL-3.0 的条款不适合你的用途（例如闭源分发、或通过网络提供服务但不公开修改），可以取得商业授权。商业授权只覆盖 CoNest 有权授权的部分，不包含上表中「不授权」的素材和第三方内容。

联系方式：请发邮件到 [2324465096@qq.com](mailto:2324465096@qq.com)。

## 贡献

贡献需在每个提交中签署 DCO（`Signed-off-by`），见 [CONTRIBUTING.md](CONTRIBUTING.md#贡献签署dco) 和 [DCO](DCO)。
