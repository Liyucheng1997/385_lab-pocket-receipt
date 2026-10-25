# 记账本（网页版 · 手机视图）

零依赖的本地记账应用：手动记账、拍照/上传账单自动识别、语音记账、记录详情与修改（含小票逐项明细）、统计与预算。界面遵循 apple-minimal 设计语言，支持深色模式，界面语言：简体中文（默认）/ English / 日本語。

**在线版：https://liyucheng1997.github.io/385_lab-pocket-receipt/**（打开后在「我的 → 智能识别」里填你自己的 Anthropic API Key 即可识别账单；记账数据和 Key 都只保存在你的浏览器里）

识别有两种引擎，自动选择：

| 引擎 | 什么时候用 | 计费 |
| --- | --- | --- |
| **本地订阅** | `npm start` 后在本机使用，经 `server.js` 调用已登录的 Claude Code | Claude 订阅额度 |
| **Anthropic API** | 在线版，或本地服务不可用时；浏览器用你填写的 API Key 直连 `api.anthropic.com` | 按 API 用量计费 |

## 本地启动

```bash
npm start
```

浏览器打开 http://localhost:3850 。手机和电脑在同一局域网时，可用终端里打印的局域网地址访问。

## 账单识别

本地运行时，识别请求由本机的 `claude` CLI 处理，模型为 `claude-opus-5-5`，消耗 Claude 订阅额度，不需要 API Key。首次使用先登录：

```bash
claude auth login
```

- 支持图片（小票、发票、银行/支付宝/微信账单截图）和 PDF，一次最多 6 个文件。
- 任何语言的账单都会把商家和备注翻译成「我的 → 语言」里设置的语言。
- 外币账单保留原币金额，并按 Claude 给出的近似汇率换算成本位币；汇率可在确认页修改。
- 识别结果先进入确认页，可逐条修改分类、金额、备注、日期后再保存。
- 在线版（API 模式）可在「我的」里选模型：Claude Opus 5.5（默认）/ Sonnet 5.5 / Haiku 5.5。API Key 存在浏览器 localStorage，不会写进 JSON 备份。

可选环境变量：`PORT`（默认 3850）、`CLAUDE_MODEL`（默认 claude-opus-5-5）、`CLAUDE_BIN`、`RECOGNIZE_TIMEOUT_MS`。

## 语音记账

使用浏览器的语音识别（Chrome / Edge / Safari），说完后由 Claude 把文字拆成多条记录，例如“午饭 35，打车 20，昨天工资到账 8000”。Claude 不可用时自动退回本地规则解析。

- Chrome 的语音识别需要访问 Google 服务；连不上时可用 Edge、Safari，或输入法自带的语音输入。
- 手机通过局域网 IP 访问时，浏览器只允许 HTTPS 页面使用麦克风。把证书放到 `certs/key.pem`、`certs/cert.pem`，服务会额外在 3851 端口开启 HTTPS，例如：

```bash
mkdir -p certs && openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout certs/key.pem -out certs/cert.pem -subj "/CN=ledger.local"
```

## 数据

记录保存在浏览器 localStorage 中，不会上传（在线版也一样，换浏览器或清除网站数据前请先备份）。可在「我的 → 数据」导出 CSV、备份/恢复 JSON。

## 目录

```
server.js            本地服务：静态文件 + /api/health + /api/recognize（调用 claude CLI）
.github/workflows/   推送 main 时把 public/ 发布到 GitHub Pages
public/css/          tokens.css（设计变量）+ app.css
public/js/app.js     入口与底部标签栏
public/js/views/     明细 / 统计 / 预算 / 我的
public/js/sheets/    记一笔键盘、账单识别、语音记账、结果确认
public/js/recognize.js  识别引擎（本地服务 / 浏览器直连 API）、图片压缩、离线兜底解析
public/js/prompt.js  识别提示词与输出结构（浏览器和 server.js 共用）
```
