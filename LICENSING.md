# 许可说明

bothouse 新增的内容按 [MIT](LICENSE) 授权，版权人为 zuiho-kai 和 bothouse 贡献者。本页说明哪些内容不在本项目授权范围内。目录来源见 [SOURCE_ORIGINS.md](SOURCE_ORIGINS.md)。

## 一句话

- 本项目：[MIT](LICENSE)。
- 上游 cc-connect：MIT，声明保留在 [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream)。
- 第三方素材和依赖：按各自许可，本项目不对它们重新授权。
- 固件和部分素材：不在本仓库。

## 上游 MIT

bothouse 是接入 [cc-connect](https://github.com/chenhg5/cc-connect)、DSH 等平台的插件。为了一条命令就能装好，`bridge/` 随附了一份 cc-connect（MIT），bothouse 的插件代码和它放在一起分发，直接来源是 [zuiho-kai/cc-connect](https://github.com/zuiho-kai/cc-connect) 的 maomao 分支。随附的 cc-connect 代码按它自己的 MIT 声明使用。

上游在 `bridge/README.md` 和 `bridge/npm/package.json` 中声明 MIT，但原先没有 LICENSE 文件。2026-10-21 已在 zuiho-kai/cc-connect 补上 MIT 正文（[zuiho-kai/cc-connect#1](https://github.com/zuiho-kai/cc-connect/pull/1)，合并提交 cd376899），[bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream) 是该文件的原样副本。chenhg5/cc-connect 本身仍没有 LICENSE 文件。上游代码的作者署名通过保留的 Git 历史和文件内归属保留。

`companion/` 来自 Zssan12/yijiazi，权利人与本仓库所有者相同，随本仓库按 MIT 授权。

## 不在本仓库、不随本仓库授权的内容

- 固件（`firmware/`、`role-household/firmware-xiaozhi/`）。
- 角色头像（`role-household/avatars/`）、圆屏原型素材和截图（`prototypes/device-ui/assets/`、`preview.png`、`test-artifacts/`）：含授权未核实的头像和 CC BY-NC 4.0 美术，见 [prototypes/device-ui/UPSTREAM-NOTICE.md](prototypes/device-ui/UPSTREAM-NOTICE.md)。
- `bridge/assets/sponsors/`、`bridge/assets/banners/`、`bridge/docs/images/sponsors/` 中的标识归各自所有者。
- `experiments/` 运行时下载的模型和权重。

## 依赖

依赖按各自许可使用，不随本仓库重新授权，直接依赖的许可见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。例如 `maunium.net/go/mautrix` 为 MPL-2.0。

## 贡献

贡献需在每个提交中签署 DCO（`Signed-off-by`），见 [CONTRIBUTING.md](CONTRIBUTING.md#贡献签署dco) 和 [DCO](DCO)。
