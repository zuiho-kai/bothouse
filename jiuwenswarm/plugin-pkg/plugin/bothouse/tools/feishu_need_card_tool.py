"""Tool: send a Feishu 需求分析卡 with group quotes, shared memory forum rules, and acceptance criteria."""
from __future__ import annotations

from typing import Any

from openjiuwen.core.foundation.tool import Tool, ToolCard

from ..common import feishu_workflow


class BothouseFeishuNeedCardTool(Tool):
    """Create and send a Feishu Need Analysis Card (需求分析卡) backed by shared team memory."""

    def __init__(self) -> None:
        super().__init__(
            ToolCard(
                id="bothouse_feishu_need_card",
                name="bothouse_feishu_need_card",
                description=(
                    "在飞书群里收到「需求分析」请求时使用（需配合 bothouse-team-workflow skill）："
                    "自动检索全队共享记忆论坛里以前定过的规矩，汇总群里原话和验收标准，"
                    "发出带「确认，开工」「再改改」按钮的需求分析卡。"
                ),
                input_params={
                    "type": "object",
                    "properties": {
                        "chat_id": {"type": "string", "description": "飞书群 chat_id"},
                        "title": {"type": "string", "description": "需求/任务标题"},
                        "user_quotes": {
                            "type": "array",
                            "description": "群里各成员原话列表，每项含 speaker 与 text",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "speaker": {"type": "string", "description": "发言人"},
                                    "text": {"type": "string", "description": "原话内容"},
                                },
                                "required": ["speaker", "text"],
                            },
                        },
                        "acceptance_criteria": {
                            "type": "array",
                            "description": "验收标准列表",
                            "items": {"type": "string"},
                        },
                        "query": {"type": "string", "description": "用于检索记忆论坛的关键词（可选）"},
                        "reply_to_message_id": {"type": "string", "description": "回复的飞书消息 ID（可选）"},
                        "dispatcher": {"type": "string", "description": "派活人名称或 open_id（可选）"},
                    },
                    "required": ["chat_id", "title", "user_quotes", "acceptance_criteria"],
                },
            )
        )

    async def invoke(self, inputs: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        try:
            return feishu_workflow.create_need_card(
                chat_id=str(inputs.get("chat_id", "")),
                title=str(inputs.get("title", "")),
                user_quotes=list(inputs.get("user_quotes") or []),
                acceptance_criteria=[str(x) for x in (inputs.get("acceptance_criteria") or [])],
                query=str(inputs.get("query", "")),
                reply_to_message_id=str(inputs.get("reply_to_message_id", "")),
                dispatcher=str(inputs.get("dispatcher", "")),
            )
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": str(exc)}

    async def stream(self, inputs: dict[str, Any], **kwargs: Any):
        yield await self.invoke(inputs, **kwargs)
