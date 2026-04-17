# Wish Wall 2.0

一个轻量的祝愿便签墙，适合部署到 Vercel。用户可以发布 Love、心愿、反馈类便签，管理员可以在后台审核、隐藏、编辑和标记心愿状态。

项目参考了 [atangccc/Serenity-Grace](https://github.com/atangccc/Serenity-Grace) 的心愿便签插件，核心代码已获得作者授权使用。请尊重原作者授权和后续安排。

## 功能

- 漂浮便签墙，支持拖拽和分类筛选。
- 昵称、留言内容、多种便签颜色。
- Supabase 存储留言，Vercel Serverless API 读写数据。
- 独立后台入口，输入正确 `ADMIN_TOKEN` 后进入管理页。
- 后台支持公开/隐藏、编辑内容、修改状态、添加达成备注、图片 URL 和 AI 回复。
- 安全管理支持 IP 哈希记录、每日留言限制和验证码验证 API 配置。

## 文件结构

```text
.
├── index.html                 # 展示页
├── styles.css                 # 展示页样式
├── script.js                  # 展示页交互
├── admin.html                 # 后台登录入口
├── admin-dashboard.html       # 后台管理页
├── admin.css                  # 后台样式
├── admin.js                   # 登录验证脚本
├── admin-dashboard.js         # 后台管理脚本
├── api/
│   ├── wishes.js              # 公开留言 API
│   ├── admin-wishes.js        # 后台留言管理 API
│   └── security-settings.js   # 后台安全管理 API
└── database/
    └── schema.sql             # Supabase 建表 SQL
```

## 部署

1. 在 Supabase 创建项目。
2. 打开 Supabase 的 `SQL Editor`，执行 `database/schema.sql`。
3. 在 Vercel 导入 GitHub 仓库，框架选择 `Other`。
4. 在 Vercel 环境变量里添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key 或 secret key
ADMIN_TOKEN=你的后台管理口令
IP_HASH_SALT=用于生成 IP 哈希的随机盐，建议填写
```

5. 部署或重新部署 Vercel。

注意：`SUPABASE_SERVICE_ROLE_KEY` 不能使用 `sb_publishable_...`。请使用 Supabase 的 service role key / secret key，并且不要把它写进前端代码或公开截图。

## 使用

- 展示页：`/index.html` 或站点根路径。
- 后台入口：`/admin.html`，也可以点击展示页右上角的钥匙图标进入。
- 后台管理页：登录成功后自动跳转到 `/admin-dashboard.html`。
- 口令错误时会停留在登录入口，不展示留言数据和管理表单。
- 安全管理：可开启记录 IP、每日留言限制、验证码校验。IP 只保存哈希值，不保存明文。

## API

```text
GET /api/wishes
POST /api/wishes
GET /api/admin-wishes
PATCH /api/admin-wishes
DELETE /api/admin-wishes
GET /api/security-settings
PATCH /api/security-settings
```

后台 API 需要请求头：

```text
Authorization: Bearer 你的 ADMIN_TOKEN
```

## 常见问题

如果发布失败，先检查 Vercel 环境变量是否完整，并在修改环境变量后重新部署。

如果出现 RLS 相关错误，通常是 `SUPABASE_SERVICE_ROLE_KEY` 填成了 publishable key，请改为 service role key / secret key。

如果后台无法进入，确认 Vercel 已配置 `ADMIN_TOKEN`，并重新部署过最新版本。
