# 云开发数据库说明

在微信开发者工具中开通云开发后，创建以下 4 个集合。

## cards（记事卡）

保存记事卡主体。

核心字段：

- `_id`：云数据库自动生成的文档 ID。
- `id`：业务 ID，用于页面分享和查询。
- `refCode`：6 位 Agent 短码（Crockford 字符集，如 `9K4X2Q`），创建时自动生成且全局唯一；用于小程序码 scene 参数、Agent 口令和 `resolveCardRef` 云函数解析。
- `title`：记事卡标题。
- `desc`：需求描述 / 摘要。
- `keyPoints`：重点 / 待确认事项，字符串数组。
- `status`：当前状态，`draft`（草稿）、`todo`（待确认/待开始）、`doing`（进行中）、`done`（已完成）。
- `creatorId`：创建者 openid，用于判断卡片归属和权限。
- `helperIds`：协助者 openid 数组。
- `isNetworkVisible`：是否对二度人脉可见，`true` / `false`。
- `source`：来源，`manual`、`wechat_ai`、`clipboard`、`screenshot`。
- `createdAt`：创建时间。
- `updatedAt`：更新时间。
- `updatedText`：更新时间文本，用于展示。

## users（用户）

保存用户基础档案，用于互助页头像、昵称展示。

核心字段：

- `_openid`：微信用户唯一标识，集合主键。
- `nickName`：昵称。
- `avatarUrl`：头像 URL。
- `intro`：一句话介绍。
- `serviceTags`：我能提供的服务标签数组。
- `initial`：无头像时的首字占位。
- `color`：无头像时的背景色。
- `createdAt`：创建时间。
- `updatedAt`：更新时间。

## relationships（协作关系）

记录用户之间的协作关系，支持一度人脉和二度人脉。

核心字段：

- `ownerId`：关系拥有者 openid。
- `contactId`：联系人 openid。
- `degree`：关系度数，`1` 表示一度人脉，`2` 表示二度人脉。
- `source`：关系来源，`invite`（邀请）、`join_request`（申请加入）、`card_coop`（卡片协作）。
- `lastInteractAt`：最近互动时间。
- `interactCount`：互动次数。
- `createdAt`：创建时间。

> 一度人脉关系是单向记录。查询「我的一度人脉」即查询 `ownerId = 我` 且 `degree = 1` 的文档。

## joinRequests（加入申请）

记录二度人脉申请加入记事卡的请求。

核心字段：

- `cardId`：目标记事卡 ID。
- `applicantId`：申请者 openid。
- `intermediaryId`：引荐人 openid（共同好友）。
- `note`：申请说明。
- `status`：申请状态，`pending`（待审）、`approved`（通过）、`rejected`（拒绝）。
- `createdAt`：创建时间。
- `updatedAt`：更新时间。

## cardActivities（协作记录）

记录记事卡上创立者与协助者的操作，用于详情页「协作记录」展示。

核心字段：

- `cardId`：目标记事卡 ID。
- `actorId`：操作者 openid。
- `actorName` / `actorAvatar`：操作者昵称、头像快照（写入时从 users 集合取，读取免 join）。
- `action`：操作类型，`update_field`（字段变更）、`join`（加入协作）。
- `detail`：中文操作描述，如「更新了标题为「xxx」」「将状态改为 进行中」「通过邀请加入协作」。
- `createdAt`：操作时间戳。

由 `updateCard`、`inviteHelper`、`approveJoinRequest` 云函数写入，通过 `getCardActivities` 云函数读取（仅创作者/协助者可查，按时间倒序返回最近 50 条）。

## 开发期权限建议

开发期可以先用较宽松权限验证流程。真实上线前建议：

- 所有写入操作通过云函数完成。
- `cards` 集合前端只读，且只能读取 `creatorId` 或 `helperIds` 包含当前用户，或 `isNetworkVisible = true` 的卡片。
- `relationships`、`joinRequests`、`cardActivities` 集合仅云函数读写。

## 环境 ID

开通云开发后，把环境 ID 填到：

```js
// config/env.js
module.exports = {
  enableCloud: true,
  cloudEnvId: '你的云开发环境 ID'
};
```
