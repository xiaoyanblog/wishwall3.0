# 便签墙

一个可部署到 Vercel 的便签墙页面。留言提交到 Supabase 数据库后会立即展示。

## 部署步骤

1. 在 Supabase 创建一个项目。
2. 打开 Supabase SQL Editor，执行 `database/schema.sql`。
3. 在 Vercel 导入这个项目。
4. 在 Vercel Project Settings -> Environment Variables 添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
```

5. 部署后访问网站，用户提交的留言会进入 `public.wishes` 表并立即展示。
6. 如果需要隐藏某条留言，可以在 Supabase Table Editor 里把它的 `approved` 改成 `false`。

## 数据流

- `GET /api/wishes`：返回 `approved = true` 的留言。
- `POST /api/wishes`：提交新留言，默认立即公开展示。

`SUPABASE_SERVICE_ROLE_KEY` 只能放在 Vercel 环境变量里，不要写到前端文件或公开仓库。
