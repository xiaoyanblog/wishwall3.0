# Wish Wall 3.0

一个轻量、干净、带后台管理的祝福便签墙。适合部署到 Vercel，使用 Supabase 存储留言、后台安全设置和通知记录。

Wish Wall 3.0 是一个新项目版本，数据库脚本按全新结构设计，不做旧版本向下兼容。执行 `database/schema.sql` 会重建相关表。

## 3.0 更新说明

- 前台图片加载优化：页面打开后优先显示文字内容，图片延后分批加载，并带转圈加载动画，避免大量图片拖慢首屏。
- 后台移动端优化：手机访问后台时，留言管理、安全管理、通知管理改为底部固定导航，打开页面先看到内容，不再被大块菜单挤占首屏。
- 管理员登录验证码：安全设置中新增“管理员登录开启验证码”，可按需要求后台登录先完成 hCaptcha。
- 通知管理：后台新增通知管理页面，支持新留言邮件通知、测试邮件、通知收件箱/发送日志。
- 发信方式：支持传统 SMTP，也支持 Brevo API 发信。
- 数据库重置：`schema.sql` 新增 `notification_settings`、`notification_logs`，并保留留言、安全设置、提交日志表。

## 功能

- 前台便签墙：支持昵称、留言内容、分类、颜色、访客图片 URL 和拖拽展示。
- 心愿状态：支持进行中、已达成、达成备注、图片 URL 和 AI 回复文案。
- 图片懒加载：带图片的留言先显示文字，再加载图片。
- 后台留言管理：查看全部留言、搜索筛选、公开/隐藏、编辑、删除、查看 IP。
- 安全管理：支持 IP 记录、每 IP 每日留言次数限制、hCaptcha 验证码、管理员登录验证码。
- 通知管理：配置新留言邮件通知，查看通知发送状态。
- API 发信：当前集成 Brevo Transactional Email API。
- SMTP 发信：支持 SMTP、STARTTLS、SSL/TLS。
- 安全渲染：前台留言使用文本渲染，避免 XSS 注入。

## 文件结构

```text
.
├── index.html                  # 前台展示页
├── styles.css                  # 前台样式
├── script.js                   # 前台交互
├── admin.html                  # 后台登录页
├── admin-dashboard.html        # 后台管理页
├── admin.css                   # 后台样式
├── admin.js                    # 后台登录逻辑
├── admin-dashboard.js          # 后台管理逻辑
├── api/
│   ├── wishes.js               # 前台留言 API
│   ├── admin-wishes.js         # 后台留言管理 API
│   ├── security-settings.js    # 安全设置 API
│   └── notification-settings.js # 通知设置和通知收件箱 API
└── database/
    └── schema.sql              # Supabase 数据库重建脚本
```

## 部署教程

1. 在 GitHub 创建或使用仓库，例如 `xiaoyanblog/wishwall3.0`。
2. 在 Supabase 创建新项目。
3. 打开 Supabase 的 `SQL Editor`。
4. 复制并执行 `database/schema.sql` 的全部内容。
5. 在 Vercel 导入 GitHub 仓库，Framework Preset 选择 `Other`。
6. 在 Vercel 环境变量中添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
ADMIN_TOKEN=你的后台管理口令
```

7. 保存环境变量后重新部署。

注意：`SUPABASE_SERVICE_ROLE_KEY` 必须使用 Supabase 的 service role key，不要使用 publishable key，也不要把它写进前端代码或公开截图。

## 数据库说明

`database/schema.sql` 会删除并重建以下表：

- `wishes`
- `security_settings`
- `notification_settings`
- `notification_logs`
- `wish_submission_logs`

这是 3.0 的全新数据库结构。执行脚本会清空旧数据，适合首次部署或重新开始。

## 使用说明

- 前台页面：站点根路径或 `/index.html`。
- 前台添加照片：勾选“添加照片”后填写图片 URL / 图床地址，会写入后台同一个“达成图片 URL”字段。
- 后台入口：`/admin.html`。
- 后台管理页：登录成功后自动跳转到 `/admin-dashboard.html`。
- 留言管理：审核、隐藏、编辑、删除留言，查看留言详情。
- 安全管理：配置 IP 记录、每日限制、前台验证码、管理员登录验证码。
- 通知管理：配置邮件通知和查看通知收件箱。

手机访问后台时，页面底部会显示“留言管理 / 安全管理 / 通知管理”导航，更适合移动端操作。

## hCaptcha 配置

在后台 `安全管理` 中填写：

```text
Site Key / 前台标识
Secret Key
验证 API
```

hCaptcha 的验证 API 通常是：

```text
https://api.hcaptcha.com/siteverify
```

可用开关：

- 开启验证码：用户发布留言时需要完成验证码。
- 管理员登录开启验证码：管理员登录后台时需要完成验证码。

验证码前端展示成功后，后端仍会调用验证 API 校验 token，校验通过才会继续处理请求。

## 通知管理教程

后台进入 `通知管理`，先打开“开启新留言邮件通知”，再选择发信方式。

### 使用 Brevo API 发信

1. 在 Brevo 创建并验证发件邮箱或发信域名。
2. 在 Brevo 后台创建 API Key。
3. 在通知管理中选择 `Brevo API`。
4. 填写：

```text
收件邮箱
发件邮箱
发件人名称
邮件标题前缀
Brevo API Key
```

5. 保存通知设置。
6. 点击“发送测试邮件”验证配置。

Brevo Transactional Email API 使用：

```text
POST https://api.brevo.com/v3/smtp/email
Header: api-key: 你的 Brevo API Key
```

相关文档：

- https://developers.brevo.com/reference/quickstart-reference
- https://developers.brevo.com/reference/send-transac-email

### 使用传统 SMTP 发信

1. 在通知管理中选择 `传统 SMTP`。
2. 填写：

```text
收件邮箱
发件邮箱
发件人名称
邮件标题前缀
SMTP 主机
SMTP 端口
SMTP 账号
SMTP 密码 / 授权码
```

3. 如果端口是 `465`，通常需要开启 `使用 SSL/TLS`。
4. 如果端口是 `587`，通常不勾选 SSL/TLS，系统会使用 STARTTLS。
5. 保存后点击“发送测试邮件”。

如果发送失败，失败原因会写入通知收件箱。

## API

```text
GET    /api/wishes
POST   /api/wishes

GET    /api/admin-wishes
PATCH  /api/admin-wishes
DELETE /api/admin-wishes

GET    /api/security-settings
PATCH  /api/security-settings

GET    /api/notification-settings
PATCH  /api/notification-settings
POST   /api/notification-settings
```

后台 API 需要请求头：

```text
Authorization: Bearer 你的 ADMIN_TOKEN
```

## 常见问题

如果留言发布失败，先检查 Vercel 环境变量是否完整，并确认修改环境变量后已经重新部署。

如果出现 RLS 或权限相关错误，通常是 `SUPABASE_SERVICE_ROLE_KEY` 填成了 publishable key，请改成 service role key。

如果后台安全设置或通知管理读取失败，通常是还没有执行最新的 `database/schema.sql`。

如果 hCaptcha 验证失败，请确认 Site Key 和 Secret Key 是同一套，并确认验证 API 是 `https://api.hcaptcha.com/siteverify`。

如果 Brevo 发信失败，请确认发件邮箱或域名已经在 Brevo 中通过验证，并检查 API Key 是否有 Transactional Email 权限。

## 致谢

项目参考了 [atangccc/Serenity-Grace](https://github.com/atangccc/Serenity-Grace) 的心愿便签插件设计思路，核心代码已获得作者授权使用。
