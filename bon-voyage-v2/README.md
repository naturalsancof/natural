# Bon voyage v2

一个使用 Supabase 的轻量旅行留言板。v2 保持既有 `notes` 表字段兼容，并将页面、样式、数据访问和图片上传逻辑拆开。

## 结构

```
index.html          页面结构
css/style.css       响应式样式
js/supabase.js      Supabase 浏览器配置
js/notes.js         读取、发布与 Realtime 订阅
js/storage.js       图片校验与上传
js/app.js           页面交互和状态渲染
```

## 本地运行

这是纯静态站点。用任意静态文件服务器从项目根目录提供页面；不要直接双击 `index.html`，以免浏览器限制 ES module 的加载。

## Supabase 配置

在 `js/supabase.js` 填入项目 URL 和 **publishable / anon key**。浏览器端只能使用这类公开键；绝不能提交 `service_role` key 或其他管理员密钥。

应用沿用已有字段，因此不要求迁移：

```text
notes(id, author, content, img_url, created_at)
```

图片使用名为 `notes` 的 Storage bucket，并写到 `images/YYYY-MM-DD/<uuid>.<ext>`。当前实现接受 JPEG、PNG、WebP、GIF，单个文件不超过 5 MB，并保留原始格式；没有在浏览器端伪装扩展名。

## Realtime（手动检查）

页面已订阅 `public.notes` 的 Postgres Changes，替代原先的 2 秒轮询。此代码不会更改数据库。若页面发布后不自动更新，请在 Supabase Dashboard 的 **Database → Replication / Publications** 中确认 `notes` 已加入 `supabase_realtime` publication；不同项目界面和权限策略可能不同。

若需要 SQL，请先在 Supabase SQL Editor 审核后执行（仅当 `notes` 尚未启用 Realtime 时）：

```sql
alter publication supabase_realtime add table public.notes;
```

如果运行时报权限错误，请检查你现有 RLS policy 是否允许匿名角色对 `notes` 执行所需的 `SELECT` 和 `INSERT`，以及对 Storage `objects` 执行上传。不要为了“让它能跑”而开启匿名 `DELETE`；v2 前端没有删除入口。

## v2 的变化

- 修正图片预览元素的 HTML 拼写，并在更换/移除图片时释放预览 URL。
- 用 MIME type、大小限制与 UUID 路径保护图片上传，避免所有文件被命名为 `.jpg`。
- 用明确的加载、空、错误和发布状态取代 `alert` 与静默失败。
- 使用 Supabase Realtime 驱动后续留言刷新；发布成功时仅额外刷新一次以照顾未启用 Realtime 的项目。
- 优化了窄屏布局、焦点样式、图片比例与无障碍状态提示。
