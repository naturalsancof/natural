# Bon voyage

公开的旅行留言板。旅人留下文字、可选照片和可选地点；页面有足迹地图、评论、管理员登录和浅色 / 深色主题。数据仍在原来的 Supabase 项目里。

这一版用 [Astryx](https://astryx.atmeta.com/)（React 19 与 StyleX）重做了界面。拉丁文用 Neutral 主题指定的 Figtree，中文用仓库里自托管的思源宋体（Source Han Serif SC）。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

Vercel 使用 `npm run build`，输出目录是 `dist`。

## Supabase

浏览器只使用 publishable key，写在 `src/lib/supabase.js`，与原先的静态页相同。可以用 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY` 覆盖，不设置时仍连到现有项目。不要把 `service_role` key 放进这个仓库。

留言表沿用 `notes(id, author, content, img_url, location, lat, lng, created_at)`，评论在 `comments`，地点修改走 `set_note_location`。图片上传到名为 `notes` 的 Storage bucket。
