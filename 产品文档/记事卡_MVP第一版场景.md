# 《记事卡》MVP 第一版场景

## 1. 定位与边界

**一句话定位**：把微信里的客户事项，变成一张双方可确认、可提醒、可跟进的卡。

**明确不做**：报价、合同、收款、发票、完整 CRM、复杂项目管理、自动读取微信聊天记录。

---

## 2. 首页 / 商家工作台

### 2.1 当前实现

页面：`/pages/home/home`

首页承载商家日常工作的核心入口：

- **顶部 Hero 区**：品牌标题、AI 提示、快捷操作。
- **日历条**：左右各 15 天，可切换日期筛选最近记事卡。
- **最近记事卡列表**：按时间展示需求确认、服务进度等卡片。
- **下拉新建**：通过 `pull-create-trigger` 组件支持下拉/点击新建事项。
- **底部 Tab**："事项" / "服务" 切换（`tab-bar` 组件）。

### 2.2 服务.png 参考方向

`服务.png` 提供了首页视觉升级方向：

- **绿色渐变 Hero**：顶部大色块，传递服务者个人品牌感。
- **"一起协作过的人"**：以圆形头像横向排列客户网络，强调"人"而非"任务"。
- **"TA和朋友们需要什么"**：下方卡片式需求/服务入口。
- **底部双 Tab**："事项" / "服务" 清晰切换。

### 2.3 建议首页结构

```text
Julian
一起协作过的人
同频的人，终会相遇

[+] 李群  王珏什  米娅林  何诗怡
添加

TA和朋友们需要什么
[服务卡片入口]
[服务卡片入口]

──────────────
今天有 3 件事要跟

待客户确认
- 王女士｜官网改版需求确认

今日提醒
- 16:00 提醒李总补充资料

最近记事卡
- 企业官网改版｜进行中
- 品牌物料设计｜待确认

[≡ 事项]  [○ 服务]
```

### 2.4 关键交互

| 入口 | 动作 | 跳转 |
|---|---|---|
| 客户网络头像 | 点击 | 该客户的记事卡列表或详情 |
| + 添加 | 点击 | 新建记事卡 / 从聊天整理 |
| 服务卡片 | 点击 | 对应服务或需求入口 |
| 下拉/按钮 | 触发 | `/pages/intake/intake` |
| 微信 AI 提示 | 点击 | `/pages/intake/intake?source=wechat_ai&...` |
| 底部 Tab "服务" | 点击 | `/pages/profile-card/profile-card` |

---

## 3. 服务页 / 服务名片

### 3.1 当前实现

页面：`/pages/profile-card/profile-card`

服务名片是商家的需求入口型个人主页：

- 商家头像、名称、服务介绍；
- "说说你的需求" 按钮；
- "预约沟通" 按钮；
- 分享名片能力。

客户通过分享进入后，可直接提交需求并留下手机号。

### 3.2 服务.png 参考方向

`服务.png` 强化了服务者的个人品牌感和轻量需求入口：

- 顶部绿色背景 + 个人名称；
- 圆形头像列表代表协作过的客户；
- 下方卡片展示"TA和朋友们需要什么"，暗示需求可来自客户及其推荐。

### 3.3 建议服务页结构

```text
张三
品牌设计顾问

我能帮你：
- 官网设计
- 品牌梳理
- 宣传物料

[说说你的需求]
[预约沟通]
[保存联系方式]

──────────────
[分享名片]
```

### 3.4 关键交互

| 入口 | 动作 | 结果 |
|---|---|---|
| 说说你的需求 | 点击 | 展开需求表单，收集手机号、需求描述 |
| 预约沟通 | 点击 | 进入预约时间选择 |
| 保存联系方式 | 点击 | 保存商家手机号/微信 |
| 分享名片 | 点击 | 生成分享卡片，路径 `/pages/profile-card/profile-card` |

客户提交需求后，商家端首页生成一条新的待确认记事卡。

---

## 4. 微信 AI 接入准备

### 4.1 唤起方式

微信 AI 或其他外部入口通过小程序 URL 唤起：

```
/pages/home/home?source=wechat_ai&skill=xxx&intent=xxx&context=xxx
```

### 4.2 启动参数约定

当前 `app.js` 已接入 `normalizeLaunchContext()`，解析以下参数：

| 参数 | 说明 | 示例 |
|---|---|---|
| `source` | 来源标识 | `wechat_ai` |
| `skill` | 技能名 | `draft_from_chat`、`customer_intake`、`service_progress` 等 |
| `intent` | 用户意图 | `create_draft`、`show_progress`、`book_meeting` |
| `context` | 上下文文本 | 聊天摘要、需求描述 |
| `customer_phone` | 客户手机号 | `138****1234` |
| `card_id` | 已有卡片 ID | 用于查询进度或补充 |

### 4.3 Skill 注册表

当前 `services/skill-registry.js` 与 `agent/skills.json` 定义了 6 个 skill：

| skill | 作用 | 唤起页面 |
|---|---|---|
| `draft_from_chat` | 从聊天上下文生成草稿 | `/pages/intake/intake` |
| `customer_intake` | 客户提交需求 | `/pages/profile-card/profile-card` |
| `service_progress` | 查看服务进度 | `/pages/progress/progress` |
| `confirm_requirement` | 客户确认需求 | `/pages/customer-confirm/customer-confirm` |
| `book_meeting` | 预约沟通 | `/pages/profile-card/profile-card` |
| `share_profile` | 分享服务名片 | `/pages/profile-card/profile-card` |

### 4.4 页面承接

| 入口页面 | 检测到 `source=wechat_ai` 后的行为 |
|---|---|
| `home` | 显示 AI 提示条，建议"生成需求确认卡"或"查看某客户进度" |
| `intake` | 自动填充 `context` 到聊天输入区，用户点击"生成草稿" |
| `profile-card` | 若带客户信息，预填姓名/手机号，减少输入 |
| `customer-confirm` | 直接展示指定卡片供客户确认 |
| `progress` | 直接展示指定卡片的服务进度 |

### 4.5 数据与状态约定

- 草稿状态统一使用 `JISHIKA_PENDING_DRAFT` 写入本地 Storage；
- 卡片数据统一走 `utils/store.js`，云数据库优先，失败降级本地；
- 手机号作为客户唯一 ID，保存卡片时同步维护 `customers` 集合；
- AI 生成的草稿必须经商家确认后才能发给客户，不能直接保存为最终内容。

### 4.6 当前代码中的准备情况

| 项 | 状态 | 说明 |
|---|---|---|
| 启动参数解析 | ✅ | `app.js` + `services/ai-adapter.js` 已实现 |
| Skill 注册表 | ✅ | `services/skill-registry.js` + `agent/skills.json` 已对齐 |
| 首页 AI 提示 | ✅ | `home.js` 已显示 `launchHint` |
| 草稿生成 | ⚠️ | `ai-adapter.js` 目前为本地规则模拟，未接入真实 AI |
| OCR 截图识别 | ❌ | 上传截图后仅记录文件信息，未调用 OCR |
| 云函数解析 | ❌ | `cloudfunctions/` 仅预留目录，未实现 `parseContext` |
| 订阅消息提醒 | ❌ | `reminderTemplateIds` 为空，需后台配置 |

---

## 5. 当前实现清单 vs 待补充

### 已实现

- 首页 `home`：日历、最近记事卡、下拉新建、底部 Tab。
- 服务名片 `profile-card`：商家介绍、客户提交需求、预约沟通、分享。
- 从聊天整理 `intake`：文本粘贴、截图上传、类型选择、AI 草稿生成。
- 草稿编辑 `card-edit`：商家编辑字段并保存。
- 客户确认 `customer-confirm`：客户确认或补充。
- 服务进度 `progress`：节点时间线、商家操作、客户视图。

### 待补充（为微信 AI 和顺化体验）

- 接入真实 AI/OCR 替换 `ai-adapter.js` 的本地规则；
- 实现 `cloudfunctions/parseContext` 用于服务端上下文解析；
- 配置微信 AI 的 skill 唤起参数和模板；
- 配置订阅消息模板 ID；
- 首页按 `服务.png` 升级为 Hero + 客户网络 + 服务卡片布局。
