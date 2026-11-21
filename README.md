# 记账本（网页版 · 手机视图）

零依赖的本地记账应用，核心是**拍照记账**：对着小票、发票或账单拍一张，AI 自动填好金额、商家、分类、支付方式和逐项明细。青柠风格界面，支持深色模式，界面语言：简体中文（默认）/ English / 日本語。

## 功能

- **拍照 / 相册 / PDF 识别**：一次最多 6 个文件，外币自动换算，原图随记录保存，重复导入的记录会标出「可能重复」
- **语音记账、手动记账**（带计算器键盘）
- **账户与资产**：现金、支付宝、微信、储蓄卡、信用卡等账户余额与净资产，账户间转账
- **日历视图**：按天查看收支，可补记任意一天
- **统计**：周 / 月 / 年趋势、分类占比环形图、与上期对比、单笔排行、月度账单
- **预算**：月总预算与分类预算
- **周期记账**：房租、订阅等每周 / 每月自动记一笔
- 搜索、CSV 导出、JSON 备份与恢复

**在线版：https://fattura.liyucheng.me**（注册账号后使用，记录保存在服务器上；在「我的 → 智能识别」里填你自己的 Anthropic API Key 即可识别账单）

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

记录保存在浏览器 localStorage 中、小票照片保存在浏览器 IndexedDB 中，都不会上传；JSON 备份不包含照片（在线版也一样，换浏览器或清除网站数据前请先备份）。可在「我的 → 数据」导出 CSV、备份/恢复 JSON。

## 目录

```
server.js            本地服务：静态文件 + /api/health + /api/recognize（调用 claude CLI）
public/css/          tokens.css（设计变量）+ app.css
public/js/app.js     入口与底部标签栏
public/js/views/     明细 / 统计 / 资产 / 我的 / 预算
public/js/sheets/    「+」入口、记一笔键盘、账单识别、语音记账、结果确认、记录详情
public/js/accounts.js   账户与余额
public/js/photos.js     小票照片（IndexedDB）
public/js/recognize.js  识别引擎（本地服务 / 浏览器直连 API）、图片压缩、离线兜底解析
public/js/prompt.js  识别提示词与输出结构（浏览器和 server.js 共用）
```

## 账号模式与服务器部署

默认（`npm start`）不需要登录，数据只在本机浏览器。加上 `--accounts`（或环境变量 `ACCOUNTS=1`）就进入账号模式：

- 打开先看到登录 / 注册页，每个账号的记录、设置、小票照片各自保存在服务器的 `DATA_DIR`（默认 `./data`）里。
- 本机仍留一份缓存：断网也能记，联网后自动同步；多台设备登录同一账号会互相合并。
- 第一次登录时，如果这台设备上有登录前记的账，会询问是否导入到账号里。
- 密码只保存 scrypt 哈希；登录、注册有次数限制；「我的」里可以改密码、退出、注销账号。

```
node server.js --accounts            # 本机试用，数据在 ./data
```

| 环境变量 | 说明 |
| --- | --- |
| `ACCOUNTS=1` | 开启账号模式 |
| `DATA_DIR` | 用户数据目录（备份这个目录即可） |
| `PORT` / `HOST` | 监听端口与地址，放在 nginx 后面时用 `HOST=127.0.0.1` |
| `TRUST_PROXY=1` | 信任反向代理传来的 `X-Forwarded-*` 头 |
| `INVITE_CODE` | 设置后注册必须填邀请码；不设则任何人都能注册 |
| `ANTHROPIC_API_KEY` | 设置后由服务器统一做 AI 识别（所有账号共用，按用量计费）；不设则每个用户在「我的」里填自己的 Key |
| `RECOGNIZE_DAILY_LIMIT` | 每个账号每天的识别次数上限，默认 100 |

线上地址 <https://fattura.liyucheng.me>。发布 / 更新：

```
bash deploy/deploy.sh
```

脚本把代码传到服务器的 `/opt/apps/fattura` 并重启 `app-fattura` 服务；首次运行还会建好 nginx 站点和 HTTPS 证书。服务器上的配置在 `/opt/apps/fattura/.env`（参考 `deploy/env.example`），改完执行 `sudo systemctl restart app-fattura`。
