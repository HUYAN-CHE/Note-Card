# wecom-archiver（企微会话存档拉取服务）

云托管常驻容器：每 2 分钟从企微拉取会话存档消息，解密后把「外部联系人单聊文本」调云函数 `wecomIngest` 入卡。

## SDK 准备（不进 git，体积大且需从官方渠道获取）

1. 官方文档页下载 **Linux x86 v3.0**（openssl 3.0 版）：
   https://wwcdn.weixin.qq.com/node/wwcomm/sdk_x86_v3_20250205.tgz
   （来源：[企微开发者文档 · 获取会话内容](https://developer.work.weixin.qq.com/document/path/91774)）
2. 解压后把 `C_sdk/` 目录放到 `sdk/` 下，目录结构应为：
   `sdk/C_sdk/WeWorkFinanceSdk_C.h`、`sdk/C_sdk/libWeWorkFinanceSdk_C.so`
3. 校验 md5：`f2db3dd1372c516db6290afbd1b5c698`（见 `sdk/C_sdk/md5.txt`）

## 部署

- 云托管控制台新建服务，选本目录 Dockerfile 构建；或微信开发者工具 → 云托管 → 上传部署。
- 环境变量：`WECOM_CORPID`、`WECOM_SECRET`、`WECOM_PRIVATE_KEY`（RSA 私钥 PEM 全文）、`INGEST_SYSTEM_KEY`（与 `wecomIngest` 云函数环境变量一致）。
- 云数据库需建集合 `wecomArchiveState`（游标存储，权限所有用户不可读写）。

## 联调

- `GET /` 健康检查；`GET /pull` 手动触发一轮拉取。
- 日志看 `[pull]` / `[ingest]` / `[msg]` 前缀。
