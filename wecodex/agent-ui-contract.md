# Agent-Friendly UI 约定

本小程序可以做视觉优化，但不能影响 AI、Agent、自动化脚本和辅助功能对页面的理解。

## 原则

- 关键操作必须有清晰中文按钮文案，不能只用图标、符号或装饰图形表达。
- 主要按钮必须带 `data-action`，用于稳定识别操作意图。
- `data-action` 应尽量和 `agent/skills.json` 里的 skill 或其下游动作保持一致。
- 输入框必须带 `data-field` 或 `aria-label`，用于理解字段含义。
- 装饰性视觉元素使用 `aria-hidden="true"`，避免干扰读取。
- 页面结构顺序必须符合真实任务流程，不为了视觉效果打乱内容顺序。
- 客户侧页面只展示客户需要确认、补充和查看的内容。

## 当前核心动作

| 页面 | data-action | 含义 |
|---|---|---|
| 首页 | `create_from_chat` | 从聊天整理生成记事卡 |
| 首页 | `continue_ai_context` | 继续整理微信 AI 带来的上下文 |
| 首页 | `open_service_profile` | 打开服务名片 |
| 首页 | `new_blank_card` | 新建空白记事卡 |
| 首页 | `open_card` | 打开已有记事卡 |
| 从聊天整理 | `select_card_type` | 选择整理类型 |
| 从聊天整理 | `paste_clipboard` | 粘贴剪贴板内容 |
| 从聊天整理 | `upload_screenshot` | 上传聊天截图 |
| 从聊天整理 | `generate_draft` | 生成记事卡草稿 |
| 草稿编辑 | `save_and_preview_customer_card` | 保存并预览客户卡 |
| 草稿编辑 | `share_saved_customer_card` | 分享已保存的客户卡 |
| 草稿编辑 | `open_progress` | 进入服务进度 |
| 客户确认 | `confirm_card` | 客户确认需求无误 |
| 客户确认 | `submit_supplement` | 客户提交补充内容 |
| 服务进度 | `complete_progress_node` | 完成某个进度节点 |
| 服务进度 | `request_reminder` | 设置节点提醒 |
| 服务进度 | `share_progress` | 分享进度给客户 |
| 服务进度 | `complete_service` | 标记服务完成 |
| 服务名片 | `submit_need` | 提交需求并生成需求卡 |
| 服务名片 | `share_profile` | 分享服务名片 |
| 服务名片 | `book_meeting` | 预约沟通 |

## 视觉调整注意

- 可以使用渐变、漂浮纸片、装饰卡片，但不要把核心信息只放在装饰里。
- 主流程文字必须在真实按钮、标题、表单标签或列表项中出现。
- 图标旁边必须有文字说明，或该图标只是装饰并设置 `aria-hidden="true"`。
- 新增页面时，先定义主要 `data-action` 再做视觉细节。
