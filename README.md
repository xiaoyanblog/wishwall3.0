# 便签墙 Wish Wall

一个可以部署到 Vercel 的轻量便签墙。用户发布留言后会写入 Supabase 数据库，并立即展示在页面上。

页面风格参考了 [atangccc/Serenity-Grace](https://github.com/atangccc/Serenity-Grace) 的便签墙页面，感谢原作者的开源主题提供灵感。

## 功能

- 漂浮便签墙
- 便签拖拽
- 昵称和留言内容
- Love / 心愿 / 反馈 分类
- 多种便签颜色
- Vercel Serverless API
- Supabase 数据库存储
- 可手动隐藏不合适留言

## 项目结构

```text
.
├── index.html              # 页面结构
├── styles.css              # 页面样式
├── script.js               # 前端交互
├── api/
│   └── wishes.js           # Vercel API，负责读写 Supabase
└── database/
    └── schema.sql          # Supabase 建表 SQL
```

## 部署前准备

你需要准备三个账号：

- GitHub：放源码
- Supabase：存留言
- Vercel：部署网站

## 第一步：创建 Supabase 数据库

1. 打开 [Supabase](https://supabase.com/)。
2. 登录后创建一个新项目。
3. 进入项目后，左侧点击 `SQL Editor`。
4. 新建一个 Query。
5. 打开本项目里的 `database/schema.sql`，复制全部内容。
6. 粘贴到 Supabase SQL Editor。
7. 点击右下角 `Run`。

如果看到类似下面的提示，就说明成功了：

```text
Success. No rows returned
```

这是正常的。因为这段 SQL 是建表，不是查询数据，所以不会返回表格结果。

建好后，左侧进入 `Table Editor`，应该能看到一张表：

```text
wishes
```

## 第二步：找到 Supabase 环境变量

进入 Supabase 项目后，打开：

```text
Project Settings -> API
```

或者新版界面可能叫：

```text
Project Settings -> Data API
```

你需要复制两个值：

```text
Project URL
service_role key / secret key
```

在 Vercel 里它们对应的变量名是：

```text
SUPABASE_URL=你的 Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 service_role 或 secret key
```

注意：

- `SUPABASE_URL` 一般长这样：`https://xxxx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` 不能用 `sb_publishable_...`
- `SUPABASE_SERVICE_ROLE_KEY` 应该是 `sb_secret_...` 或老版本的 `eyJ...` 开头长字符串
- 不要把 `SUPABASE_SERVICE_ROLE_KEY` 写进前端代码
- 不要把 `SUPABASE_SERVICE_ROLE_KEY` 截图发到公开地方

如果填成 `sb_publishable_...`，发布留言时通常会出现：

```text
new row violates row-level security policy
```

## 第三步：部署到 Vercel

1. 打开 [Vercel](https://vercel.com/)。
2. 点击 `Add New...`。
3. 选择 `Project`。
4. 选择你的 GitHub 仓库。
5. `Framework Preset` 选择 `Other`。
6. `Build Command` 留空。
7. `Output Directory` 留空。
8. 展开 `Environment Variables`。
9. 添加两个环境变量：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

10. 点击 `Deploy`。

部署完成后，Vercel 会给你一个网址，例如：

```text
https://your-project.vercel.app
```

打开这个网址就可以使用便签墙。

## 第四步：测试是否成功

打开部署后的网站：

1. 输入昵称。
2. 输入留言。
3. 选择颜色。
4. 点击 `发布`。

正常情况下会看到：

```text
发布成功
```

然后新便签会马上出现在墙上。

你也可以回到 Supabase：

```text
Table Editor -> wishes
```

这里应该能看到刚刚提交的新留言。

## 如何隐藏不合适留言

本项目默认发布后立即显示。为了方便后期处理不合适内容，数据库里保留了 `approved` 字段。

如果你想隐藏某条留言：

1. 打开 Supabase。
2. 进入 `Table Editor`。
3. 打开 `wishes` 表。
4. 找到那条留言。
5. 把 `approved` 改成 `false`。
6. 刷新网站。

页面只会读取：

```text
approved = true
```

的留言。

## 常见问题

### 1. 页面提示“提交留言失败”

先去 Vercel 看日志：

```text
Project -> Logs
```

如果看到：

```text
Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY
```

说明 Vercel 环境变量没有填，或者填完后没有重新部署。

解决方法：

1. 进入 Vercel 项目。
2. 打开 `Settings -> Environment Variables`。
3. 检查 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。
4. 保存后重新部署。

### 2. 日志里出现 RLS 错误

如果看到：

```text
new row violates row-level security policy
```

通常是 `SUPABASE_SERVICE_ROLE_KEY` 填错了。

请确认你填的是 `service_role key` 或 `secret key`，不是 `publishable key`。

### 3. 发布成功但页面没有新便签

可以检查：

- Supabase 的 `wishes` 表里有没有新数据
- 那条数据的 `approved` 是否为 `true`
- Vercel 是否部署的是最新代码
- 浏览器是否需要刷新

### 4. 修改环境变量后还是不生效

Vercel 修改环境变量后，旧部署不会自动更新。需要重新部署：

```text
Project -> Deployments -> Redeploy
```

## 数据接口

```text
GET /api/wishes
```

读取所有 `approved = true` 的留言。

```text
POST /api/wishes
```

提交新留言，新留言默认立即展示。

## 致谢

页面视觉和交互参考：

- [Serenity-Grace](https://github.com/atangccc/Serenity-Grace)

感谢原作者开源主题。本项目只是一个适合 Vercel + Supabase 部署的轻量实现，方便个人站点快速使用。
