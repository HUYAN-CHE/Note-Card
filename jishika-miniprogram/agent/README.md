# 记事卡 Agent / Skills 说明

当前不做独立运行的 Agent，而是先定义一组轻量 Skills，方便微信 AI、云函数、前端路由和未来第三方入口统一调用。

## 为什么先做 Skills

- 微信 AI 入口规则可能继续变化，过早做重型 Agent 容易返工。
- 《记事卡》的核心动作很明确：整理聊天、生成需求卡、生成进度卡、整理群待办、预约沟通、打开互助页。
- Skills 可以先作为稳定的能力契约，后续无论微信 AI、公众号助手号、云函数还是小程序内 AI 都能复用。

## 调用格式

微信 AI 或后端推荐以小程序 query 的形式唤起：

```text
/pages/card-import/card-import?source=wechat_ai&skill=create_requirement_card&intent=requirement&context=客户说想做官网改版
```

字段说明：

- `source`：来源，微信 AI 建议用 `wechat_ai`。
- `skill`：能力名，见 `skills.json`。
- `intent`：轻量意图，可用于辅助判断卡片类型。
- `context`：用户主动提供或授权带入的上下文摘要，需要 URL encode。

小程序接收到上下文后会在「从聊天整理」页自动填充并生成预览。

## 当前 Skills

- `create_card_from_chat`：从聊天整理记事卡。
- `create_requirement_card`：生成需求确认卡。
- `create_progress_card`：生成服务进度卡。
- `create_group_todo`：整理群聊待办。
- `create_meeting_record`：生成预约记录。
- `open_mutual_help`：打开互助页。

## 重要边界

- 不自动读取微信聊天记录。
- 不绕过创立者确认。
- 不直接发送记事卡给他人。
- 不处理报价、合同、收款、发票。
- 不把原始聊天长期默认保存。

## 后续接入建议

1. 云函数新增 `parseContext`，负责调用真实 AI/OCR。
2. 云函数新增 `resolveSkill`，把用户自然语言映射到 skill。
3. 小程序继续用 `services/skill-registry.js` 作为前端路由表。
4. `agent/skills.json` 作为后端和微信 AI 的能力清单源。
