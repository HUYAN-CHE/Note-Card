# AGENTS.md

## 语言与沟通

- 所有思考过程、分析、推理必须使用中文。
- 所有回复正文必须使用中文。
- 代码、文件路径、技术术语、命令行参数保持英文。
- 简洁直接，先行动后提问。

## 项目背景

本项目是微信生态小程序《记事卡》（又称《轻跟进》），当前聚焦 MVP 微信小程序开发。

## Git 备份与提交规范

### 备份规则
- 每天用户说"结束"时，执行一次同步提交并 push 到 GitHub。
- 用户随时说"同步"，立即执行同步提交并 push。
- 任何功能性改动完成后，必须提交并 push，不能只留在本地。

### 提交信息格式
```
[yyyy-mm-dd] type(scope): 简短描述
```

### type（必填）
- init      项目初始化
- sync      每日/手动同步备份（无功能性改动）
- feat      新增功能
- fix       修复问题
- refactor  重构
- style     UI/样式调整
- docs      文档更新
- chore     配置/构建/杂项
- wip       进行中（临时提交）

### scope（必填）
- global    全局/多项目
- jishika   jishika-miniprogram 项目
- wecodex   wecodex 项目
- home      首页
- card      卡片相关
- progress  进度页
- profile   个人资料/名片
- intake    录入/信息采集
- ai        AI 服务/适配器
- cloud     云函数
- config    配置文件

### 示例
```
[2024-06-24] sync(global): 每日同步备份
[2024-06-24] feat(jishika/home): 首页新增空状态提示
[2024-06-24] fix(wecodex/card-edit): 修复卡片保存失败
[2024-06-24] style(jishika/progress): 调整进度环颜色
[2024-06-24] refactor(wecodex/ai): 优化错误处理逻辑
```

### 回滚
- 任何改动都可通过 GitHub 历史或本地 `git log` 找回。
- 回滚前必须确认目标提交哈希，不能凭空手动改文件冒充回滚。
