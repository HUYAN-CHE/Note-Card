# 云开发数据库说明

在微信开发者工具中开通云开发后，建议先建两个集合：

## cards

保存记事卡主体。

核心字段：

- `id`：业务 ID，用于页面分享和查询。
- `type`：卡片类型，`requirement`、`progress`、`todo`、`meeting`。
- `typeLabel`：类型展示名。
- `customerName`：客户称呼。
- `phone`：客户手机号，后续作为客户唯一 ID。
- `projectName`：项目或事项名称。
- `summary`：需求摘要。
- `keyPoints`：重点事项。
- `questions`：待确认问题。
- `progressNodes`：服务进度节点。
- `status`：当前状态。
- `stage`：阶段展示名。
- `source`：来源，手动、名片、聊天粘贴、微信 AI 等。
- `updatedAt`：更新时间。
- `creatorId`：创建者 openid，用于判断卡片归属和权限。
- `helperIds`：协助者 openid 数组，互助页据此聚合一度人脉。
- `visibility`：可见范围，`private`（仅协作人）、`friends`（一度人脉可见）、`public`（公开）。

## users

保存用户基础档案，用于互助页头像、昵称展示。

核心字段：

- `openid`：微信用户唯一标识，集合主键。
- `nickName`：昵称。
- `avatarUrl`：头像 URL。
- `color`：无头像时的背景色。
- `initial`：无头像时的首字占位。
- `updatedAt`：更新时间。

## customers

保存轻量客户档案。

核心字段：

- `phone`：客户唯一识别字段。
- `customerName`：客户称呼。
- `updatedAt`：更新时间。

## 开发期权限建议

开发期可以先用较宽松权限验证流程。真实上线前建议改为云函数读写，并通过分享 token 控制客户访问，不要让客户侧直接按卡片 ID 任意读取。

## 环境 ID

开通云开发后，把环境 ID 填到：

```js
// config/env.js
module.exports = {
  enableCloud: true,
  cloudEnvId: '你的云开发环境 ID'
};
```

