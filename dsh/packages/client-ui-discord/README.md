# Channel settings / 频道设置

频道设置分为三个 Tab，每页独立保存：

- **基本**：频道名称；工作区名称由系统分配，保持只读。
- **派活**：派活方式和主角色，修改后点击保存才生效。
- **工作区**：工作目录；保存成功后仍可选择立即重建会话或稍后生效。

切换 Tab 保留未保存输入。保存只提交当前页有变化的字段；成功和服务端错误仅显示在对应页。派活页沿用两个独立接口；若主角色保存失败而派活方式已保存，重试仅提交失败的字段。

关闭时如有任一页未保存，确认框会提示丢弃改动；取消后继续编辑。保存请求进行中暂不关闭。左右方向键、Home 和 End 可切换 Tab，Tab 可进入当前页，Esc 触发关闭流程。

Channel settings has three tabs, each with its own Save button:

- **Basic**: channel name; system-assigned workspace names remain read-only.
- **Dispatch**: dispatch mode and primary role; edits apply only after Save.
- **Workspace**: working directory; after saving, choose whether to recreate sessions now or apply it later.

Switching tabs preserves drafts. Save submits only changed fields in the current tab. Success and exact service errors appear only in that tab. Dispatch retains its two existing endpoints; if the mode saves but the primary role fails, retry submits only the failed field.

Closing with unsaved changes asks whether to discard them. Cancel keeps editing. The dialog stays open while a save is pending. Arrow keys, Home and End switch tabs, Tab enters the active panel, and Escape follows the same close confirmation flow.
