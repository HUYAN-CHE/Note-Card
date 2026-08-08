# 云函数说明

当前 MVP 逐步实现云函数化，前端直连云数据库作为兜底。

## 已实现的云函数

| 云函数 | 作用 |
|---|---|
| `login` | 获取当前用户 openid |
| `getMutualHelpers` | 查询当前用户的一度人脉 |
| `getNetworkCards` | 查询某一度人脉本人的可见卡（own）+ 其二度人脉可见卡（secondDegree） |
| `getMyHomeData` | 获取我的主页数据 |
| `analyzeServiceTags` | 分析记事卡，提取服务能力标签候选 |
| `createCard` | 创建记事卡 |
| `updateCard` | 更新记事卡 |
| `getCardDetail` | 按身份返回记事卡详情 |
| `inviteHelper` | 接受邀请成为协助者，按邀请人建立一度/二度关系 |
| `applyToJoinCard` | 二度人脉申请加入记事卡 |
| `approveJoinRequest` | 创作者审批加入申请 |

## 后续建议

1. 所有卡片写入操作逐步迁移到云函数，前端只做只读查询。
2. 新增 `parseContext`：调用真实 AI/OCR 解析聊天上下文。
3. 新增 `resolveSkill`：把用户自然语言映射到 skill。
4. `sendReminder` 已就位（每日 9:00 定时，提前一天提醒临近截止卡片），待小程序后台申请订阅消息模板并把模板 ID 填入函数顶部 `TEMPLATE_ID` 后即生效。
