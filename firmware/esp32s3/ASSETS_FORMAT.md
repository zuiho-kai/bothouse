# CNAS v1 · 板端素材包格式

`tools/pack_assets.py` 生成、固件侧读取。写这份文档是为了让读端只依赖这一个
文件就能实现，不需要再猜生成脚本的内部结构。

- 生成：`python3 tools/pack_assets.py --ffmpeg <path> --out build/assets.bin`
- 校验：`python3 -m unittest discover -s tests -p 'test_pack_assets.py'`
- 每个片段是一串**完整、独立可解码**的 466×466 baseline JPEG 帧，不是视频流。

## 布局

全部**小端序**，结构体无填充（`#pragma pack` 语义）。三段连续：头部 → 片段表 →
（每段的）帧索引表 → JPEG 数据。索引表都在 JPEG 数据之前，所以读端可以先只读
头部和索引，再按需 seek 取帧。

```
偏移 0
┌─────────────────────────────┐
│ header                      │  8 字节
├─────────────────────────────┤
│ segment table               │  23 × count 字节
├─────────────────────────────┤
│ frame index table(s)        │  8 × frames 字节，每段一块，按片段表顺序
├─────────────────────────────┤
│ JPEG bytes                  │  首尾相接
└─────────────────────────────┘
```

### header（8 字节）

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | `char[4]` | `magic` | 固定 `"CNAS"`（0x43 0x4E 0x41 0x53） |
| 4 | `uint16` | `version` | 当前为 `1` |
| 6 | `uint16` | `segment_count` | 片段数 |

### 片段表（每项 23 字节，紧接头部）

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | `char[16]` | `name` | ASCII，`\0` 右填充，最长 15 字节 |
| 16 | `uint8` | `fps` | 播放帧率，`0` 非法 |
| 17 | `uint16` | `frames` | 该片段帧数，`0` 非法 |
| 19 | `uint32` | `index_offset` | 该片段帧索引表在文件里的**绝对**偏移 |

第 `i` 项位置 = `8 + 23 * i`。`name` 是 `\0` 结尾的 C 字符串，读端用
`strncmp`/`memcmp` 匹配即可；**不保证**片段表有序，按名字查而不是按下标猜。

`fps` 是**逐段**的。当前这个包四段恰好同一个值，但读端不要写死——按每段自己
那项 `fps` 计时，否则以后哪段单独调帧率就会播错速。

### 帧索引表（每项 8 字节）

第 `i` 段第 `f` 帧的位置 = `index_offset + 8 * f`。

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | `uint32` | `offset` | 该帧 JPEG 起始在文件里的**绝对**偏移 |
| 4 | `uint32` | `len` | JPEG 字节数，`0` 非法 |

帧是自包含的：从 `offset` 取 `len` 字节就是一张能直接喂给解码器的 JPEG，
不需要参考前后帧。

### JPEG 数据

- 尺寸 466×466，`RGB`，baseline（SOF0，**不是** progressive SOF2）；
- YUV420 采样（4:2:0），与 `benchmarks/jpeg` 里的 fixture 规格一致；
- 起始 `FF D8`，结束 `FF D9`。

## C 结构体参考

```c
#include <stdint.h>

#define CNAS_MAGIC "CNAS"
#define CNAS_VERSION 1
#define CNAS_NAME_LEN 16
#define CNAS_SCREEN 466

typedef struct __attribute__((packed)) {
    char     magic[4];      /* "CNAS" */
    uint16_t version;
    uint16_t segment_count;
} cnas_header_t;             /* 8 B */

typedef struct __attribute__((packed)) {
    char     name[CNAS_NAME_LEN];
    uint8_t  fps;
    uint16_t frames;
    uint32_t index_offset;
} cnas_segment_t;            /* 23 B */

typedef struct __attribute__((packed)) {
    uint32_t offset;
    uint32_t len;
} cnas_frame_t;              /* 8 B */
```

`_Static_assert(sizeof(cnas_segment_t) == 23, ...)` 值得加一条：这几个结构体
依赖 `packed`，编译器一旦插入填充，字段就会整体错位。

读端至少要做的检查（生成端已经保证，但落板后 Flash 损坏、烧错分区都会破坏它）：

1. `memcmp(magic, "CNAS", 4) == 0`，`version == 1`；
2. 片段表、索引表、每帧的 `offset + len` 都在分区容量内；
3. `fps != 0 && frames != 0`；
4. 每帧前两字节是 `FF D8`（JPEG SOI）。

## 每段的取帧区间

**只缩 `idle`，另外三段保持完整**——`listening` / `thinking` / `speaking` 都是
首尾闭合的整圈循环，截一半会在循环接缝处跳帧。

起点、`scale`/`tx`/`ty` 仍来自 `source.html`，所以画面和网页圆屏一致；板端只是
从同一段素材里取不同的帧区间。这个覆盖**只对板端生效，不改 `source.html`**。

| 片段 | 板端取帧区间 | 时长 | 为什么 |
| --- | --- | --- | --- |
| `idle` | 6.90s–9.65s | 2.75s | 在 idle 原片 4.65–9.90s 里搜出的首尾最接区间（见下） |
| `listening` | 0s–4.04s（整段） | 4.04s | 首尾闭合整圈，不截 |
| `thinking` | 0s–3.96s（整段） | 3.96s | 中性 → 歪头问号 → 复位中性，整圈，不截 |
| `speaking` | 0s–4.04s（整段） | 4.04s | 首尾闭合整圈，不截 |

### idle 区间是怎么选出来的

在 idle 原片里遍历 2.0~3.0 秒的所有候选区间（按 12fps 的帧格走），算每个候选
**首尾帧的平均像素差**，取最小的那个。差值越小，循环回接时越不跳。

    python3 tools/pack_assets.py --ffmpeg <path> --auto-idle-range

输出（gpt）：

    idle 自动选段：6.900s–9.650s（2.75s，首尾帧平均差 9.30 级）

这就是 `BOARD_PLAN["idle"]["range"]` 的默认值，复核用上面的命令重跑即可。
各长度下的最优区间对照：

| 候选时长 | 最优区间 | 首尾差 |
| --- | --- | --- |
| 2.00s | 7.15–9.15 | 11.08 级 |
| 2.50s | 6.90–9.40 | 9.85 级 |
| **2.75s** | **6.90–9.65** | **9.30 级** |
| 3.00s | 6.82–9.82 | 10.86 级 |

### 覆盖方式

    --board-range idle=6.9,9.65          # 只对板端生效，可重复
    --auto-idle-range                    # 重新搜索（较慢，约 5 秒）
    --full-length                        # 全部用整段，仅排查用，会超预算

## 预算与降级

默认总大小上限 **7 MiB**（`--budget-mib`）。生成脚本按固定阶梯尝试，取第一个
装得下的档：

1. `fps ≤ 12, Q80`（起始档）
2. `fps ≤ 12, Q75`
3. `fps ≤ 11, Q75`
4. `fps ≤ 10, Q75`（下限）

`Q75` 和 `10fps` 是**下限**，脚本不会为了塞进预算继续往下掉。到最低档还超预算
就**报错退出（退出码 2）并且不写文件**，同时在 stderr 打逐段大小，让人去决定
是提高预算、砍小动作还是缩短片段。没有 `--allow-over-budget` 之外的悄悄放宽路径。

当前 gpt 的实际结果（`--extras 0`，7 MiB 预算，落到最低档）：

| 片段 | 区间 | 时长 | fps | 帧数 | 字节 | KiB |
| --- | --- | --- | --- | --- | --- | --- |
| `idle` | 6.90–9.65s | 2.75s | 10 | 28 | 1,208,142 | 1179.8 |
| `listening` | 0–4.04s | 4.04s | 10 | 41 | 2,091,927 | 2042.9 |
| `thinking` | 0–3.96s | 3.96s | 10 | 40 | 1,875,619 | 1831.7 |
| `speaking` | 0–4.04s | 4.04s | 10 | 41 | 1,720,579 | 1680.3 |
| **合计** | | 14.79s | — | **150** | **6,897,567** | **6735.9（6.58 MiB）** |

占 7 MiB 预算 **94.0%**，余量 442,465 B（432.1 KiB）。起始档 `Q80/12fps` 是
8.82 MiB 装不下，按阶梯降到最低档 `Q75/10fps` 才通过——这是约定下限，没有更低。

## 与网页圆屏的关系

裁切参数**不复制**一份，而是直接读 `prototypes/device-ui/source.html` 的
`CHARACTER_CONFIG`（它同时是 `screen.js` 的构建源，见 `prototypes/device-ui/build.py`）。
网页改了 `scale`/`tx`/`ty`/`start`/`end`，重新打包就跟上，不会两边数字各自漂移。

换算方式：网页对视频元素做 `translate(tx%, ty%) scale(s)`，
`transform-origin: 50% 50%`，元素按 `object-fit: cover` 铺满圆屏，所以

```
screen = half + t + s * (elem - half)
```

取逆得到 466×466 画面在源视频里的取景框。`scale` 小于「刚好铺满」时取景框会
超出画面边缘，那块在网页上露出的是片段的 `bg` 底色——生成端用 `bg` 填满，
**不做夹紧**。夹紧会让整幅画面位移，例如 `thinking` 的 `ty=+6.2%` 会在顶部留约
22px 底色，夹掉之后人物和问号的位置就跟网页对不上。

## 片段名

| name | 来源 | 说明 |
| --- | --- | --- |
| `idle` | `clips.idle` | 待机 |
| `listening` | `clips.listening` | 倾听 |
| `thinking` | `clips.thinking_question` 或 `clips.thinking_calm` | 由 `--thinking` 决定，默认 `question` |
| `speaking` | `clips.speaking` | 说话 |
| `<小动作名>` | `idleVariants.*` | 待机随机小动作，如 `yawn`、`doze`、`curious` |

小动作的片段名就是它的 key，读端按名字挑，不要假设一定存在——`--extras 0`
时只有前四个。
