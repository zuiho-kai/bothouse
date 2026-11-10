---
name: feature-xiaoyi-contact-search
description: search_contact 设备联系人搜索工具概览：薄适配层经 execute_device_command 下发 SearchContactLocal、固定 executeParam、入口契约（ToolInputError / RuntimeError）与日志验证（contact_tools.py）
metadata:
  scope: 只收 search_contact 的功能概览；调用链、异常分支与测试等实现细节归 feature-depth-xiaoyi-contact-search
---
# search_contact 设备联系人搜索工具（feature-xiaoyi-contact-search）

## 现状

- **职责边界与控制流**
- 该工具是薄适配层：清洗输入（strip）后组装一条 Common/Action 设备命令，委托 `execute_device_command("SearchContactLocal", command)` 与设备侧调度服务通信，本身不持有通讯录数据。返回值做防御性归一化：非 dict 的 outputs 包装为 `{"outputs": outputs}`，非 dict 的 result 置空，再统计 `result["items"]` 条数用于日志与提示语。日志统一带 `[SEARCH_CONTACT_TOOL]` 前缀。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L45-L56),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L82–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L82-L95)
- **命令参数与固定设置**
- 意图执行参数硬编码在 `executeParam` 中：`intentName: "SearchContactLocal"`、`bundleName: "com.huawei.hmos.aidispatchservice"`、`executeMode: "background"`、`needUnlock: True`、`actionResponse: True`、`appType: "OHOS_APP"`、`timeOut: 5`、`achieveType: "INTENT"`；检索词通过 `intentParam: {"name": name_clean}` 传入。
  - 这些值均为代码内常量，未见外部配置项或环境变量覆盖路径。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L56–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L56-L80)
- **search_contact 入口契约**
- 异步函数 `search_contact(name: str) -> Dict[str, Any]`，描述声明返回的 `content[0].text` 为设备 outputs 的 JSON 字符串。入口先校验参数：name 非字符串或去空白后为空时抛出 `ToolInputError("缺少必填参数 name")`；其余异常记录日志后包装为 `RuntimeError("搜索联系人失败: ...")`，而 `ToolInputError` 被原样上抛。工具描述中还向调用方声明 60 秒超时并提示最多重试一次。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L30–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L30-L47),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L93–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L93-L102)
- **按姓名检索设备联系人**
- 按联系人姓名在设备通讯录中检索详细信息（描述称包括姓名、电话号码、邮箱、组织、职位等），实现方式是组装 Common/Action 命令并调用 `execute_device_command("SearchContactLocal", command)`，目标意图为 `SearchContactLocal`、bundle 为 `com.huawei.hmos.aidispatchservice`。
  - 返回前对结果做防御性归一化（非 dict 的 outputs 包装、非 dict 的 result 置空），统计 `result["items"]` 条数写入日志并体现在成功提示「搜索到联系人信息（N 条）」中。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L30–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L30-L36),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L64–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L64-L71),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L82–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L82-L96)
- **Validation and Observability**
- The validation within the function is limited to input and exception contracts: it throws `ToolInputError` when `name` is not a string or is empty after trimming (L46–L47); when other exceptions occur, it logs an error and wraps them into `RuntimeError` before re-raising (L98–L102).
  - At runtime, logs prefixed with `[SEARCH_CONTACT_TOOL]` record search terms and the number of items in the result (L51–L54, L91).
  - No test cases or test entry points for `search_contact` appear within the source code slice provided this time; the existence of tests outside the slice cannot be confirmed or denied.
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L45-L54),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L87–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L87-L102)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-contact-search.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L82-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L56-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L30-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L93-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L30-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L64-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L82-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L87-L102
- 源页字段（feature）：xiaoyi-contact-search
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py
