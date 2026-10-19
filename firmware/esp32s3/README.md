# ESP32-S3 固件

目标板：Waveshare ESP32-S3-Touch-AMOLED-1.75（1.75 英寸 AMOLED 圆屏，466×466）。

当前 main 上只有**素材打包工具**。IDF 工程骨架（`main/`、网络与设备协议状态机、
`provision.py`、主机侧 `tests/`）在 PR #72（`feat/42-idf-skeleton`）里，合入后
本节需要补上编译说明，并把下面「素材打包」并进那份 README，而不是各留一份。

> 素材打包工具是纯主机侧脚本，**不需要 ESP-IDF，也不需要板子**。

## 素材打包

把圆屏角色的动画片段打包成板端可直接读取的 `assets.bin`：

    pip install pillow
    python3 tools/pack_assets.py --ffmpeg /path/to/ffmpeg --out build/assets.bin --verify

- **ffmpeg 必须显式给出**（`--ffmpeg`，或环境变量 `FFMPEG_PATH`，或已在 `PATH`）。
  脚本里没有写死任何第三方应用自带的 ffmpeg 路径。
- 素材来自 `prototypes/device-ui/assets/characters/<角色>/`，裁切参数直接读
  `prototypes/device-ui/source.html` 的 `CHARACTER_CONFIG`，所以板端画面和网页
  圆屏同源，不会各写一份数字。
- 输出 466×466 baseline JPEG（YUV420）帧序列，总大小默认上限 11 MiB。
- **四段都用网页同款的完整片段**，不再截子段。Flash 分区放大到 12 MiB
  （打包预算 11 MiB）之后不必再省；`idle` 整段 4.65–9.90s 里有眨眼，
  首尾接不接得上跟网页完全一致。
- 这个覆盖**只对板端生效，不改 `source.html`**；起点和 `scale`/`tx`/`ty` 仍取自
  `source.html`，画面与网页圆屏一致。
- 当前实测合计 **10.25 MiB / 211 帧**（含两张状态图），占 11 MiB 预算 93.2%、
  余量 765 KiB，**起始档 `Q80/12fps` 一次通过**。
- **8MB Flash 的备用方案**：`--budget-mib 7 --board-range idle=4.65,7.15`
  （idle 截成 2.5s 含眨眼子段），实测 6.49 MiB / 149 帧。
- 逐段大小一定会打印（含区间、时长、fps、帧数）；最低档仍超预算就报错退出
  （退出码 2）并且不写文件。
- 这一版**不带**待机小动作（`--extras` 默认 0），留到下一版。
- `--status-dir` 可把**断网 / 出错**的静态图各打成 1 帧、`fps=1` 的片段
  （`offline` / `error`），每张约 30 KiB。G哥 的素材前缀是 `gge`，
  工具里有默认映射，也可以 `--status-prefix` 覆盖。

常用参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--character` | `gpt` | 角色目录名 |
| `--thinking` | `question` | `question` 用带问号原片，`calm` 用无问号安静段 |
| `--extras` | `0` | 额外打包几段待机小动作；这一版固件先不带，留到下一版 |
| `--board-range` | 空 | `NAME=START,END`，只对板端生效的取帧区间，可重复；不改 `source.html` |
| `--auto-idle-range` | 关 | 自动搜索 idle 首尾最接的 2–3s 子段（约 5 秒）；默认不用，8MB 备用方案可参考 |
| `--status-dir` | 空 | 静态状态图目录，取 `<前缀>-offline.png` / `<前缀>-error.png` 各 1 帧、fps=1 |
| `--status-prefix` | 角色名 | 状态图文件名前缀（gpt 的素材叫 `gge`，已内置默认映射） |
| `--full-length` | 关 | 全部用 `source.html` 的完整片段（仅排查画质，会超预算） |
| `--seed` | `0` | 小动作抽样种子，固定以保证打包可复现 |
| `--budget-mib` | `11` | 总大小预算 |
| `--report` | 无 | 写出 JSON 报告（每段源文件、裁切框、帧数、字节数、整体 SHA256） |
| `--verify` | 关 | 打包后立刻解包自检 |

**文件格式见 [ASSETS_FORMAT.md](ASSETS_FORMAT.md)**：头部、片段表、帧索引表、
预算阶梯，以及一份可直接照抄的 C 结构体和读端必须做的边界检查。

## 测试

    python3 -m unittest discover -s tests -p 'test_pack_assets.py'

需要 Pillow。端到端用例还需要 ffmpeg：从 `FFMPEG_PATH` 或 `PATH` 找，找不到就
**明确跳过并说明跳过了什么**，不会把跳过当成通过。纯容器布局和裁切换算的用例
不需要 ffmpeg。
