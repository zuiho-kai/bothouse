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
- **按落板方案截短**（`docs/BOARD_ASSETS_PLAN.md` §3）：`idle` 取 2.5s 眨眼子段；
  `listening`、`thinking`、`speaking` 是闭合循环，保持完整、降到 10fps。起点仍取
  `source.html`，所以画面和网页圆屏一致。当前实测合计 **6.54 MiB / 150 帧**，
  落在 Q75 档（预算 93.5%）。
- 逐段大小一定会打印（含时长、fps、帧数）；超预算时按 `Q80 → Q75 → 11fps → 10fps`
  降级，最低档仍超预算就报错退出（退出码 2）并且不写文件。
- 这一版**不带**待机小动作（`--extras` 默认 0），留到下一版。

常用参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--character` | `gpt` | 角色目录名 |
| `--thinking` | `question` | `question` 用带问号原片，`calm` 用无问号安静段 |
| `--extras` | `0` | 额外打包几段待机小动作；这一版固件先不带，留到下一版 |
| `--full-length` | 关 | 不截短、用 `source.html` 的完整片段（仅排查画质，会超预算） |
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
