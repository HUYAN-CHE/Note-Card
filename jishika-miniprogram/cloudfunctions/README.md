# 云函数预留目录

当前 MVP 先使用小程序端直连云数据库，并保留本地存储兜底。

正式上线前建议补云函数：

- `parseContext`：调用 AI/OCR，把聊天、截图、语音摘要整理成记事卡草稿。
- `resolveSkill`：根据用户自然语言和上下文选择 `agent/skills.json` 中的能力。
- `createShareToken`：生成客户可访问的分享 token，避免直接暴露卡片 ID。
- `updateCardByCustomer`：客户确认/补充时通过 token 更新指定卡片。
- `sendReminder`：节点提醒和订阅消息发送。
- `verifyPhone`：手机号验证码或微信授权手机号校验。
