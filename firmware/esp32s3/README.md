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
- 输出 466×466 baseline JPEG（YUV420）帧序列，总大小默认上限 7 MiB。
- **只缩 `idle`，另外三段保持完整**：`listening` / `thinking` / `speaking` 都是
  首尾闭合的整圈循环，截一半会在接缝处跳帧。`idle` 取 **4.65–7.15s（2.50s）**，
  从 `source.html` 的起点开始，含完整一次眨眼（动作峰值 19.38 级）。
- 这个覆盖**只对板端生效，不改 `source.html`**；起点和 `scale`/`tx`/`ty` 仍取自
  `source.html`，画面与网页圆屏一致。
- 当前实测合计 **6.43 MiB / 147 帧**，占 7 MiB 预算 91.9%，余量 580 KiB。
  起始档 `Q80/12fps` 装不下，按阶梯降到最低档 `Q75/10fps` 才通过。
- `--auto-idle-range` 会把「首尾差」和「段内动作峰值」一起打出来。这版 idle
  整段不是闭合循环，两个目标不可兼得：首尾差最优的 6.90–9.65s 峰值只有 8.14 级
  （几乎静止），所以默认值取有眨眼的 4.65–7.15s。详见 `ASSETS_FORMAT.md`。
- 逐段大小一定会打印（含区间、时长、fps、帧数）；最低档仍超预算就报错退出
  （退出码 2）并且不写文件。
- 这一版**不带**待机小动作（`--extras` 默认 0），留到下一版。

常用参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--character` | `gpt` | 角色目录名 |
| `--thinking` | `question` | `question` 用带问号原片，`calm` 用无问号安静段 |
| `--extras` | `0` | 额外打包几段待机小动作；这一版固件先不带，留到下一版 |
| `--board-range` | 空 | `NAME=START,END`，只对板端生效的取帧区间，可重复；不改 `source.html` |
| `--auto-idle-range` | 关 | 重新搜索 idle 的首尾最接区间（约 5 秒），用于复核默认值 |
| `--full-length` | 关 | 全部用 `source.html` 的完整片段（仅排查画质，会超预算） |
| `--seed` | `0` | 小动作抽样种子，固定以保证打包可复现 |
| `--budget-mib` | `7` | 总大小预算 |
| `--report` | 无 | 写出 JSON 报告（每段源文件、裁切框、帧数、字节数、整体 SHA256） |
| `--verify` | 关 | 打包后立刻解包自检 |

**文件格式见 [ASSETS_FORMAT.md](ASSETS_FORMAT.md)**：头部、片段表、帧索引表、
预算阶梯，以及一份可直接照抄的 C 结构体和读端必须做的边界检查。

## 测试

    python3 -m unittest discover -s tests -p 'test_pack_assets.py'

需要 Pillow。端到端用例还需要 ffmpeg：从 `FFMPEG_PATH` 或 `PATH` 找，找不到就
**明确跳过并说明跳过了什么**，不会把跳过当成通过。纯容器布局和裁切换算的用例
不需要 ffmpeg。
