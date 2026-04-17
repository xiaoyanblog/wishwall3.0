# 标签墙 2.0 后台管理说明

后台入口：

```text
/admin.html
```

## 部署前配置

在 Vercel 项目的环境变量里新增：

```text
ADMIN_TOKEN=你自己的管理口令
```

同时保留原来的 Supabase 环境变量：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 service role key / secret key
```

保存环境变量后，需要重新部署一次 Vercel。

## 后台能做什么

- 查看全部留言，包括公开和隐藏的留言。
- 按内容、昵称搜索留言。
- 按公开、隐藏、进行中、已达成筛选。
- 修改留言内容、昵称、分类、颜色和状态。
- 隐藏或重新公开某条留言。
- 给已达成心愿添加备注和图片 URL。
- 给留言添加 AI 回复文案。
- 删除不需要保留的留言。

## 安全提醒

- 不要把 `ADMIN_TOKEN` 写进前端源码。
- 不要使用 Supabase 的 `service_role key` 作为后台口令。
- 如果怀疑口令泄露，直接在 Vercel 修改 `ADMIN_TOKEN` 并重新部署。
