# 许可说明

bothouse 中由本项目权利人拥有的代码与资料按 [Apache-2.0](LICENSE) 授权。本页说明各组件的权利与许可边界；来源见 [SOURCE_ORIGINS.md](SOURCE_ORIGINS.md)。

## 一句话

- bothouse 项目代码（包括 `companion/`）：[Apache-2.0](LICENSE)。
- `bridge/` 中来自 cc-connect 的上游代码：按其上游 MIT 声明使用；相关许可文本保留于 [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream)。
- 第三方素材和依赖：按各自许可使用，本项目不对它们重新授权。

## bridge/ 中的上游 MIT 代码

bothouse 是接入 [cc-connect](https://github.com/chenhg5/cc-connect)、DSH 等平台的插件。为便于安装，`bridge/` 随附 cc-connect 的代码快照。上游项目 [chenhg5/cc-connect](https://github.com/chenhg5/cc-connect) 的 README 声明 MIT，但该仓库没有 LICENSE 文件；这里说明的许可依据仅为上游 README 中的声明，不表示该仓库有 MIT 许可正文。

`bridge/LICENSE-MIT-upstream` 保留 cc-connect 的 MIT 许可文本与版权声明。该文件来自 zuiho-kai/cc-connect 中补充的 MIT 文件。随附的 cc-connect 来源代码按其上游 MIT 声明使用，不因本项目采用 Apache-2.0 而改变。

## companion/

`companion/` 来源于 Zssan12/yijiazi，权利人为本仓库所有者；其中纳入本仓库的项目代码按 Apache-2.0 授权。

## 不在本仓库许可范围内的内容

- `bridge/assets/sponsors/`、`bridge/assets/banners/`、`bridge/docs/images/sponsors/` 中的标识归各自所有者。
- `experiments/` 运行时下载的模型和权重。
- 第三方依赖按各自许可使用，不随本仓库重新授权；直接依赖的许可见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。例如 `maunium.net/go/mautrix` 为 MPL-2.0。

## 贡献

贡献需在每个提交中签署 DCO（`Signed-off-by`），见 [CONTRIBUTING.md](CONTRIBUTING.md#贡献签署dco) 和 [DCO](DCO)。

integrations/dsh-acp-stream/source.patch 及其派生代码采用 MIT；DeepSeek Harness 版权与许可保留于 integrations/dsh-acp-stream/LICENSE-MIT-DeepSeek。
