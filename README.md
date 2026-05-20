# UptimeNode

一个用 Node.js 实现的网站监控服务，支持站点可达性检测、HTTP 状态检查、响应时间统计、关键字检测、SSL 证书剩余天数、邮件告警、Telegram 告警，以及带密码保护的站点总览页面。

## 功能

- 周期性批量检测站点
- 检测 HTTP 状态和响应时间
- 检测页面关键字是否命中
- 显示 SSL 证书剩余天数
- 站点连续失败达到阈值后才判定为异常并发送邮件告警
- 站点恢复后发送邮件通知
- 支持 Telegram 告警通知
- 简单的网页管理面板，支持密码访问
- 本地 JSON 存储站点配置
- 运行日志按天写入 `logs/YYYY-MM-DD.log`，自动保留最近 10 天

## 目录说明

- `src/index.js`：服务入口和网页页面
- `src/monitor.js`：核心监控逻辑
- `src/storage.js`：站点与报告存储
- `src/email.js`：邮件接口封装
- `src/notifier.js`：Telegram 通知封装
- `src/config.js`：配置读取
- `src/env.js`：`.env` 加载
- `data/sites.json`：站点配置文件
- `logs/`：运行日志目录

## 环境配置

先复制一份 `.env.example` 为 `.env`，然后修改里面的配置。

### 必填或常用配置

- `PORT`：服务端口，默认 `6038`
- `PAGE_PASSWORD`：网页访问密码
- `CHECK_INTERVAL_MS`：轮询间隔，默认 `60000`
- `REQUEST_TIMEOUT_MS`：请求超时，默认 `10000`
- `SSL_CHECK_TIMEOUT_MS`：SSL 检查超时，默认 `10000`
- `FAILURE_THRESHOLD`：连续失败多少次后才判定站点异常并发送宕机通知，默认 `10`（单次检测失败不会立即算异常）

### Telegram 配置

- `TELEGRAM_ENABLED`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

启用后，机器人会自动轮询 Telegram 消息，并回复以下指令：

- `id` / `/id` / `ID` / `/ID`：返回当前聊天的 ID 和用户名
- `help` / `/help`：返回可用命令说明

如果你在群里希望直接发送普通文本 `id` 也能回复，需要在 BotFather 里关闭隐私模式；否则请使用 `/id`。

### 邮件配置

- `EMAIL_API_URL`
- `EMAIL_API_KEY`
- `EMAIL_TO`

## 本地运行

```bash
npm install
npm run dev
```

启动后浏览器访问：

```text
http://127.0.0.1:6038
```

进入页面后需要输入 `PAGE_PASSWORD` 才能查看监控面板。

## Docker 运行

```bash
cp .env.example .env
./docker-auto.sh
```

也可以直接使用 `docker compose`：

```bash
docker compose up -d --build
```

## 接口

- `GET /health`：健康检查
- `GET /sites`：读取站点列表
- `POST /sites`：新增或更新站点
- `POST /poll`：手动执行一次批量检测
- `GET /report`：读取最近一次检测结果
- `GET /snapshot`：读取当前内存中的状态快照
- `GET /`：站点总览页
- `POST /login`：密码登录

## 站点配置格式

`data/sites.json` 使用数组保存站点信息，示例：

```json
[
  {
    "name": "示例站点",
    "url": "https://example.com",
    "keywords": ["Example", "Home"]
  }
]
```

`keywords` 不填写时会跳过关键字检测。

## 注意事项

- `.env` 不要提交到仓库
- `data/report.json` 是运行时生成文件，不需要手动维护
- `logs/` 目录里的日志会按天分文件，并自动清理 10 天前的日志
- 页面是受密码保护的，但接口是否对外暴露取决于你的部署方式
