---
name: feature-depth-skill-generator-cli-3
description: skill-gen CLI 实现深读第 3 部分：url-fetch --out-json 默认值与 router 转发、httpx/bs4/lxml 依赖与 sys.path 追加、operator-playbook 命令示例（未执行）
metadata:
  scope: 只收配置、依赖、验收三个侧面；流程与 API 归 feature-depth-skill-generator-cli-1，失败模式与取舍归 feature-depth-skill-generator-cli-2
---
# skill-gen CLI（sop-text / url-fetch 子命令）：实现深读（3/3）

## 现状

- 拆分说明：本页是源页 `feature-depth-skill-generator-cli.md` 的第 3/3 部分；第 1 部分 [[feature-depth-skill-generator-cli-1]]；第 2 部分 [[feature-depth-skill-generator-cli-2]]
- **url-fetch 可选 --out-json 默认 None；router 仅显式传参才覆盖后端默认** `url-fetch` 的 `--out-json` 默认 `None`：未提供时走 stdout 日志输出，提供时递归建父目录并写 UTF-8 文件。`fetch_pages_from_url` 的 `timeout`/`user_agent` 默认 `None`，仅当非 None 时才加入转发 kwargs，否则各后端用自身默认（web_page 中为 `DEFAULT_TIMEOUT = 30.0` 与 Chrome/120 `DEFAULT_USER_AGENT`）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L81–L96
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L81-L96`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L114–L117
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L114-L117`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L19–L41
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py#L19-L41`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L24–L28
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L24-L28`）
- **web_page 依赖 httpx/bs4，lxml 缺失时回退 html.parser；CLI 把 scripts/ 追加进 sys.path** `web_page.py` 导入 `httpx` 与 `bs4.BeautifulSoup`；`_parse_html` 先尝试导入 `lxml`，捕获 `ImportError` 后改用内置 `html.parser`。CLI 的 `_ensure_skill_gen_on_path` 把脚本所在目录（追加，非前置）加入 `sys.path`（若尚未存在）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L14–L15
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L14-L15`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L44–L49
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L44-L49`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L40–L44
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L40-L44`）
- **operator-playbook 记录的 CLI 命令示例与预期 stdout 形态（documented_manual，未执行）** 文档中的人工验收步骤（本轮未执行）：
- operator-playbook L7–L19 记录以绝对路径运行 skill_generator_cli.py 的 sop-text（--sop-file，可选 --out-text/--print-raw-chars）与 url-fetch（--url，可选 --out-json）命令，并注明 sop-text 无 --out-text 时向 stdout 打印完整 UTF-8 文本、--print-raw-chars 仅打印字符数、url-fetch 输出含 text/title/source_url 的页面对象 JSON 数组。
  - 此为已记录的手工操作说明，NOT EXECUTED，本次未运行验证。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/reference/operator-playbook.md:L3–L19
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/reference/operator-playbook.md#L3-L19`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-skill-generator-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
