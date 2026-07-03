# 记事卡小程序 MVP

这是《记事卡》的第一版微信小程序骨架，核心流程是：

```text
从聊天整理 -> 生成记事卡草稿 -> 商家编辑确认 -> 客户确认/补充 -> 服务进度 -> 节点提醒
```

## 打开方式

1. 打开微信开发者工具。
2. 选择「导入项目」。
3. 项目目录选择：`/Users/huche/Desktop/CODE/wechat/jishika-miniprogram`。
4. AppID 可继续使用 `touristappid` 预览，正式开发时替换成真实小程序 AppID。

## 第一版页面

- `pages/home/home`：商家首页，今日待办、最近记事卡、微信 AI 上下文提示。
- `pages/intake/intake`：从聊天整理，支持粘贴剪贴板、上传聊天截图、选择整理类型。
- `pages/card-edit/card-edit`：商家编辑记事卡草稿，发给客户确认前必须人工确认。
- `pages/customer-confirm/customer-confirm`：客户确认需求或补充信息。
- `pages/progress/progress`：服务进度节点，商家可更新节点，客户只看当前进度。
- `pages/mutual-help/mutual-help`：互助页，查看协作朋友及其朋友的需求。

## 微信 AI 适配方式

第一版不依赖自动读取微信聊天记录，只接受用户主动带入的上下文。

预留唤起参数：

```text
/pages/home/home?source=wechat_ai&intent=requirement&context=客户说想做官网改版
```

支持字段：

- `source=wechat_ai`：标识来自微信 AI 或类似智能入口。
- `skill`：建议调用的能力，例如 `create_card_from_chat`、`create_requirement_card`。
- `intent`：建议卡片类型，可选 `requirement`、`progress`、`todo`、`meeting`。
- `context`：用户授权或主动输入的上下文摘要。

小程序启动后会在首页提示「检测到微信 AI 上下文」，用户点击后进入「从聊天整理」。

机器可读的能力清单见 `agent/skills.json`，小程序内的技能映射见 `services/skill-registry.js`。

## 当前实现边界

- 本地模拟 AI 整理，真实 AI 接口后续接入 `services/ai-adapter.js` 或云函数 `parseContext`。
- 已支持云开发优先、本地存储兜底，存储适配在 `utils/store.js`。
- 上传截图只记录文件信息，OCR 后续接入。
- 订阅消息提醒预留了 `reminderTemplateIds`，需要在真实小程序后台配置模板后接入。
- 不做报价、合同、收款、发票、完整 CRM 漏斗。

## 云开发配置

如果导入项目时勾选了微信云开发，建议先做这几步：

1. 在微信开发者工具里开通云开发环境。
2. 创建数据库集合：`cards`、`customers`。
3. 把云开发环境 ID 填入 `config/env.js` 的 `cloudEnvId`。
4. 开发期可先用前端直连云数据库验证流程；上线前建议改成云函数读写和分享 token 权限。

如果没有配置云开发，代码会自动回落到本地存储，仍然可以预览主流程。

更多字段说明见 `database.md`。

## Agent/AI 可读性

为了不让视觉设计影响 AI 或 Agent 理解页面操作，主要按钮和输入框已加入 `data-action`、`data-field` 和 `aria-label`。

界面语义约定见 `agent-ui-contract.md`。

## 体验路径

1. 首页点击「这段聊天，记成卡」。
2. 粘贴一段客户需求，例如：

```text
王女士说想做官网改版，需要移动端适配，希望 6 月底前上线，想看看品牌感强一点的案例。
```

3. 点击「生成记事卡草稿」。
4. 在草稿页编辑并点击「保存并预览客户卡」。
5. 客户确认后进入服务进度页。
