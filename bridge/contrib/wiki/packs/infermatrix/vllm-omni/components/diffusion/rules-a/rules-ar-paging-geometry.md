---
name: rules-ar-paging-geometry
description: "AR-Diffusion 分页几何规则 DIFF-15a、15b、15c：frame eviction 与 kernel page size 分离（MultipleOf(16)，832×480 的 1560 tokens/frame 分页 16）、可见 block table 保留每个真实 token 且不读 unwritten slot、ragged scratch/eviction/固定宽度同一 storage 坐标（video capacity 1756 blocks）；PR #6481"
metadata:
  scope: 只收 vllm_omni/experimental/ar_diffusion/ 的 paging_block_size、可见 KV block table 与 scratch 坐标三条规则；Scheduler-managed diffusion KV 的请求控制面归 paged-kv-control-plane
---
# AR-Diffusion 分页几何与可见 KV 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-ar-paging-geometry.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #6481；vllm_omni/experimental/ar_diffusion/runner.py；vllm_omni/experimental/ar_diffusion/kv_cache/manager.py；vllm_omni/experimental/ar_diffusion/kv_cache/paged.py；vllm_omni/experimental/ar_diffusion/kv_cache/paged_attention.py
  - tests/diffusion/ar_diffusion/test_capability_runner.py；tests/diffusion/ar_diffusion/test_kv_cache.py；tests/diffusion/ar_diffusion/test_paged_attention.py
- 置信度（confidence）：high
- 本页细化 [[rules-system-runtime-2]]（AR resident capacity DIFF-4o；源锚点 #diff-4o-ar-diffusion-容量必须覆盖持久状态分页图输入必须显式）；K/V独立存储和 stepwise session 生命周期仍按 [[rules-system-runtime-1]]、[[rules-system-runtime-2]]（system runtime） 审查。
- [DIFF-15a] frame eviction 与 kernel page size 必须分离且保留 token 预算
  - 触发：修改 AR-Diffusion `paging_block_size`、resolution geometry、reachable attention kernel 或 managed/scratch capacity。
  - 强制：从实际 dispatch module 查询 legal block sizes，消费 exact integer 或 `MultipleOf(base)`；frame tokens 已合法则保留原 page，否则用最细合法 page。当前可达 CUDA FA/ROCm AITER/upstream FA 回答 `MultipleOf(16)`，832×480的 1560 tokens/frame 因而分页16；不能把16写死为所有 backend 能力。空 legal set 必须拒绝。
  - 强制：以 `ceil(chunk_size / block_size)` 把 resident、in-flight、scratch 和 headroom 的 frame 项转换为 block 项，仍覆盖原 token 预算及独立 persistent reservations。kernel改变时 legal-size query 与 dispatch同时更新；FA4 head256 的128page只有实际 caller 开启 `supports_fa4_hd256=True` 才可成为约束，当前AR caller未开。
  - 验收：覆盖 exact/MultipleOf、多种合法集、1560→16、已对齐frame保持原page、空集与容量/预算；实际可达CUDA/ROCm分别做 numerical检查。832×480是否在旧实现可跑也依赖 kernel：最终 review 的 Hopper/FA3 baseline已能运行，不能声称所有旧路径都失败。^[PR #6481]
- [DIFF-15b] 可见 block table 必须保留每个真实 token 且绝不读 unwritten slot
  - 触发：修改 ragged AR chunk 写入、sink/recent window选择、eviction、`video_block_table` 或 action KV 拼接。
  - 强制：按实际 storage token positions选择 sink与recent的相交 blocks，按位置排序且 shared tail block去重；已evicted位置的null entries不当作KV。`kv_len`统计实际written slots，仅最后一个block可partial；前面的partial block后仍有block时 fail fast。action tokens位于video后时，video长度必须整page，否则明确拒绝。
  - 强制：保留straddling sink/recent的边界block；whole-block kernel可读边界上至多 `block_size-1` 个已写但已出window的真实旧token，不能把它们与未写slot混为一谈。24-token chunks/16page、sink1/window2的第五chunk必须保留absolute blocks0、1、4、5、6、7，不能丢block4。
  - 验收：在每个chunk的scratch与commit forward，poison全部unwritten slots并与dense reference对照；覆盖fill后eviction、两端straddling、reset边界、partial中间block和partial video+action拒绝。只测第一chunk或shape不能证明滑窗正确。^[PR #6481]
- [DIFF-15c] ragged scratch、eviction 与固定宽度必须保持同一 storage 坐标
  - 触发：修改 noncommit scratch、`visible_window_blocks`、block-table compaction、history staging 或 graph固定shape。
  - 强制：chunk从history尾的实际offset开始；noncommit可写session已拥有但尚未写入的tail slots，再接scratch pages，后续commit覆盖同slots且noncommit不得推进committed state。action scratch offset只数真正scratch pages。eviction的sink end向上取整、free end向下取整保护straddling pages；compaction只移除同时为whole chunk与whole page的gap，并保持model/storage位置关系。
  - 强制：固定video capacity为 `ceil(sink_tokens/block_size) + ceil((window_tokens + block_size - gcd(chunk_size, block_size))/block_size)`，再加action capacity；table width与`max_seq_len`来自同一block capacity，不能floor合并token数。unaligned chunk或start offset禁止复用旧history staging，必须完整restage window。
  - 验收：覆盖30-token chunk从pos30起跨3个16page、sink/recent各自rounding、eviction后坐标与长度、scratch不提交、compaction和steady fixedwidth；1560 geometry的video capacity1756blocks，加一action reservation为1757。最终head Hopper/FA3 SP2/SP4 A/B仅证明所报standard paged workload未出现明显性能变化；optional staged served性能没有被该table测量。^[PR #6481]

## 决策与踩坑

- [DIFF-15a] 禁止：用 frame size 直接当 kernel page、从GPU型号推 legal blocks、把不可达 FA4 分支施加到实际 FA2，或用细页减少 token 容量承诺。不能把“默认分辨率可构造并运行”解释成 realtime。
- [DIFF-15b] 禁止：以可见block数×page size冒充written length、从resident list两端数block而忽略真实位置、让shape正确的action路径读partial video的空洞，或把shared tail列两次。
- [DIFF-15c] 禁止：scratch从slot0起导致history tail空洞、compact任意page gap改变chunk offset，或用当前table长度掩盖容量低估导致graph shape churn。不能将optional gather+reuse的既有性能承诺带到每次full restage的ragged配置。
