# agent 技术日报

把原来的多轮 agent 调研改成 Python 标准库采集，再向原供应商发送一次无工具 Messages 请求。任务模型、频道、每天北京时间 09:30 和全局预算保持原配置。

```sh
python3 daily.py collect /path/to/insight /path/to/config.toml
python3 daily.py draft /path/to/insight /path/to/config.toml
python3 daily.py run /path/to/insight /path/to/config.toml
python3 -m unittest discover -s ops/insight -v
```

数据目录需要 sources.md 与 log.md；配置格式沿用 bothouse，读取 claude 项目的原 model/provider。collect 不调用模型；draft 使用 latest-run 只生成；run 采集、生成、发送到既有 agent技术洞察频道。采集保存原始 HTML、collection.json、截断标记和来源状态；最终稿、API usage、发送回执留在每期 runs 中。配置及凭据不复制进运行证据。

预算：素材至多 32000 UTF-8 字节，输出至多 6144 token（包含供应商自动思考）。本机 Opus 5.5 标准价 input $4/M、output $20/M、cache write $5/M、cache read $0.2/M。按字节上界及固定短提示，最坏输入约 $0.17、输出 $0.12288，合计小于 $0.30。保存实际 usage 并复算；模型更改后要求同步核价。无自动重试、工具或子任务。费用是本机标准价估算，不等于查询过网关账户账单。

HTTP 错误、截断、空稿、超预算、超过 Discord 单条限制都会退出并保留证据。发送成功后才更新成功日志和页面快照；发送失败保留成品，不伪记已发。进程中断在发送后、记账前时仍需人工核对频道，脚本不自动重发。

范围与限制：只采集来源表里的 RSS/Atom、更新页及官方博客链接；日期明确才进入当日观点，构建时间不当发布时间。热度源仅作发现线索，正文来自官网或官方仓库。HTML/JS/403、没有发布时间、素材截断均明确披露，不能据此断言全无更新。来源表新渠道和失效说明可在核验后维护；脚本不自动信任新域名。原 cron 改 exec 调用本脚本，原编号和时刻保留；脚本自己发正文，cron 的 stdout 是费用收据。
