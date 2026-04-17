# 标签墙 2.0 后台管理说明

后台入口：

```text
/admin.html
```

输入正确的 `ADMIN_TOKEN` 后，会自动跳转到：

```text
/admin-dashboard.html
```

如果口令错误，页面会停留在 `/admin.html`，不会展示留言列表、统计卡片或管理表单。

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
- 在安全管理里开启明文 IP 记录，并在留言详情里查看 IP。
- 在安全管理里设置每个 IP 每日最多留言次数。
- 在安全管理里配置验证码 Site Key、Secret Key 和验证 API。

## 安全提醒

- 不要把 `ADMIN_TOKEN` 写进前端源码。
- 不要使用 Supabase 的 `service_role key` 作为后台口令。
- 后台登录口令只保存在当前浏览器标签页会话里，关闭标签页后需要重新登录。
- 后台口令建议使用 20 位以上随机字符串，混合大小写字母、数字和符号。
- 更新到带安全管理的版本后，需要在 Supabase SQL Editor 重新执行最新 `database/schema.sql`。
- 如果怀疑口令泄露，直接在 Vercel 修改 `ADMIN_TOKEN` 并重新部署。
## Database reset note

`database/schema.sql` is now a fresh Wish Wall 2.0 reset script. Running the whole file in Supabase SQL Editor will drop and recreate the `wishes`, `security_settings`, and `wish_submission_logs` tables, so old wishes and previous security settings will be deleted.
