"""Tool: search, cite, record corrections, and run nightly flow on the shared team memory forum."""
from __future__ import annotations

from typing import Any

from openjiuwen.core.foundation.tool import Tool, ToolCard

from ..common import forum_memory


class BothouseMemoryForumTool(Tool):
    """Shared team memory forum tool: search '[版块] 对象' threads, cite, record corrections, nightly flow."""

    def __init__(self) -> None:
        super().__init__(
            ToolCard(
                id="bothouse_memory_forum",
                name="bothouse_memory_forum",
                description=(
                    "访问全队共享记忆论坛（非按角色隔离，需配合 bothouse-team-workflow skill）："
                    "action 支持 search（按关键词/版块搜帖）、cite（标记引用某条记忆）、"
                    "record_correction（记录群里/话题里的纠正，同类错第2次自动升成检查规则）、"
                    "run_nightly（夜间归帖+结果投票+折叠低分帖）、forum_snapshot（返回完整论坛视图）。"
                ),
                input_params={
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "操作类型：search | cite | record_correction | run_nightly | forum_snapshot",
                        },
                        "query": {"type": "string", "description": "搜索关键词"},
                        "section": {"type": "string", "description": "按 [版块] 过滤（可选）"},
                        "limit": {"type": "integer", "description": "返回条数上限（可选，默认 5）"},
                        "cids": {
                            "type": "array",
                            "description": "引用的记忆编号列表（cite 时用）",
                            "items": {"type": "string"},
                        },
                        "rule": {"type": "string", "description": "纠正后的规则内容（record_correction 时用）"},
                        "object": {"type": "string", "description": "帖子对象名（record_correction 时用）"},
                        "quote": {"type": "string", "description": "群里/话题里的原话（record_correction 时用）"},
                        "source": {"type": "string", "description": "出处说明（record_correction 时用）"},
                        "mistake_key": {"type": "string", "description": "同类错误标识（可选）"},
                        "actor": {"type": "string", "description": "当前同事/角色标识（可选）"},
                    },
                    "required": ["action"],
                },
            )
        )

    async def invoke(self, inputs: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        try:
            action = str(inputs.get("action", "")).strip()
            actor = str(inputs.get("actor", "team") or "team")
            if action == "search":
                threads = forum_memory.search_forum(
                    str(inputs.get("query", "")),
                    section=str(inputs.get("section", "")),
                    limit=int(inputs.get("limit") or 5),
                )
                return {"success": True, "count": len(threads), "threads": threads}
            if action == "cite":
                cids = [str(c) for c in (inputs.get("cids") or [])]
                n = forum_memory.cite_rules(cids, voter=actor)
                return {"success": True, "cited": n}
            if action == "record_correction":
                res = forum_memory.record_correction(
                    rule=str(inputs.get("rule", "")),
                    section=str(inputs.get("section", "团队规范")),
                    obj=str(inputs.get("object", "通用")),
                    quote=str(inputs.get("quote", "")),
                    source=str(inputs.get("source", "群聊")),
                    actor=actor,
                    mistake_key=str(inputs.get("mistake_key", "")),
                )
                return {"success": True, **res}
            if action == "run_nightly":
                res = forum_memory.run_nightly_flow()
                return {"success": True, **res}
            if action == "forum_snapshot":
                threads = forum_memory.scan_forum_threads()
                return {"success": True, "count": len(threads), "threads": threads}
            return {"success": False, "error": f"unsupported action: {action}"}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": str(exc)}

    async def stream(self, inputs: dict[str, Any], **kwargs: Any):
        yield await self.invoke(inputs, **kwargs)
