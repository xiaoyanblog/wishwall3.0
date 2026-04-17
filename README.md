# Wish Wall 2.0

一个轻量、干净、带后台管理的祝福便签墙。适合部署到 Vercel，用 Supabase 存储留言数据。

用户可以在前台发布 Love、心愿、反馈类便签；管理员可以在后台审核、隐藏、编辑、标记状态，并配置 IP 记录、每日留言限制和 hCaptcha 验证码。

> 项目参考了 [atangccc/Serenity-Grace](https://github.com/atangccc/Serenity-Grace) 的心愿便签插件设计思路，核心代码已获得作者授权使用。

## 功能

- 前台便签墙：支持昵称、留言内容、分类、颜色和拖拽展示。
- 后台管理：支持查看全部留言、搜索筛选、公开/隐藏、编辑、删除。
- 心愿状态：支持进行中、已达成、达成备注、图片 URL 和 AI 回复文案。
- 安全管理：支持明文 IP 记录、每 IP 每日留言次数限制、hCaptcha 验证码配置。
- 后台入口保护：输入正确 `ADMIN_TOKEN` 后进入管理页，错误口令不会展示数据。
- 安全渲染：前台留言使用文本渲染，避免 XSS 注入。

## 文件结构

```text
.
├── index.html                 # 前台展示页
├── styles.css                 # 前台样式
├── script.js                  # 前台交互
├── admin.html                 # 后台登录页
├── admin-dashboard.html       # 后台管理页
├── admin.css                  # 后台样式
├── admin.js                   # 后台登录逻辑
├── admin-dashboard.js         # 后台管理逻辑
├── api/
│   ├── wishes.js              # 前台留言 API
│   ├── admin-wishes.js        # 后台留言管理 API
│   └── security-settings.js   # 安全设置 API
└── database/
    └── schema.sql             # Supabase 数据库脚本
```

## 部署

1. 在 Supabase 创建项目。
2. 打开 Supabase 的 `SQL Editor`，执行 `database/schema.sql`。
3. 在 Vercel 导入这个 GitHub 仓库，Framework 选择 `Other`。
4. 在 Vercel 环境变量里添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key 或 secret key
ADMIN_TOKEN=你的后台管理口令
```

5. 保存环境变量后，重新部署 Vercel。

注意：`SUPABASE_SERVICE_ROLE_KEY` 不能使用 `sb_publishable_...`，必须使用 Supabase 的 service role key / secret key。不要把它写进前端代码，也不要公开截图。

## 数据库说明

`database/schema.sql` 是 Wish Wall 2.0 的全新数据库脚本，会重建以下表：

- `wishes`
- `security_settings`
- `wish_submission_logs`

如果你的数据库里已经有旧数据，执行脚本会清空并重建相关表。适合首次部署，或者想从干净的 2.0 结构重新开始。

## 使用

- 前台展示页：站点根路径或 `/index.html`。
- 后台入口：`/admin.html`，也可以点击前台左上角的钥匙图标进入。
- 后台管理页：登录成功后自动跳转到 `/admin-dashboard.html`。
- 安全管理：后台左侧菜单进入，可以开启 IP 记录、每日留言限制、hCaptcha 验证码。

开启 IP 记录后，管理员可以在留言管理的“详细”按钮里查看对应留言的 IP。

## hCaptcha

在后台安全管理里填写：

```text
Site Key / 前台标识
Secret Key
验证 API
```

hCaptcha 的验证 API 通常是：

```text
https://api.hcaptcha.com/siteverify
```

前台会在用户点击“发布”后弹出验证码。验证成功后，后端会再调用 hCaptcha API 校验 token，校验通过才会真正写入留言。

## API

```text
GET    /api/wishes
POST   /api/wishes
GET    /api/admin-wishes
PATCH  /api/admin-wishes
DELETE /api/admin-wishes
GET    /api/security-settings
PATCH  /api/security-settings
```

后台 API 需要请求头：

```text
Authorization: Bearer 你的 ADMIN_TOKEN
```

## 常见问题

如果留言发布失败，先检查 Vercel 环境变量是否完整，并确认修改环境变量后已经重新部署。

如果出现 RLS 或权限相关错误，通常是 `SUPABASE_SERVICE_ROLE_KEY` 填成了 publishable key，请改成 service role key / secret key。

如果后台安全设置读取失败，通常是还没有执行最新的 `database/schema.sql`。

如果 hCaptcha 验证失败，请确认 Site Key 和 Secret Key 是同一套，并确认验证 API 为 `https://api.hcaptcha.com/siteverify`。
