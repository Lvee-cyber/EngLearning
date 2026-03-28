# EngLearning

这个目录现在用于维护一套可部署到 GitHub Pages 的英语词库与复习前端。

词库内容和学习进度已经拆层：

- `data/words.json`
  由本地维护并提交到 GitHub，作为词条内容源
- `Supabase review_progress`
  由网页端读写，用于多端同步复习进度

## 文件说明

- [conversation_learning_rules.md](/Users/levelee/Documents/CodeX_co/EngLearning/conversation_learning_rules.md)
  当前线程的学习与复习规则文档。
- [data/words.json](/Users/levelee/Documents/CodeX_co/EngLearning/data/words.json)
  统一词库。
- [review.html](/Users/levelee/Documents/CodeX_co/EngLearning/review.html)
  复习页。
- [words.html](/Users/levelee/Documents/CodeX_co/EngLearning/words.html)
  词库查看页。
- [site-config.js](/Users/levelee/Documents/CodeX_co/EngLearning/site-config.js)
  前端站点配置。
- [supabase_schema.sql](/Users/levelee/Documents/CodeX_co/EngLearning/supabase_schema.sql)
  Supabase 建表与 RLS 策略。

## 部署结构

1. 将整个目录推到 GitHub 仓库。
2. 在 GitHub Pages 上托管静态页面。
3. 在 Supabase 中执行 [supabase_schema.sql](/Users/levelee/Documents/CodeX_co/EngLearning/supabase_schema.sql)。
4. 编辑 [site-config.js](/Users/levelee/Documents/CodeX_co/EngLearning/site-config.js)，填入：
   - `supabaseUrl`
   - `supabaseAnonKey`
   - 可选的 `defaultProfileId`

当前 `supabase_schema.sql` 使用的是演示型匿名读写策略，适合你现在这个低安全要求的个人项目。

## 当前数据流

- 词库查看页和复习页都通过 `fetch('./data/words.json')` 读取词条内容。
- 复习进度通过 Supabase 表 `review_progress` 读取和写入。
- 不同设备只要填写同一个“同步标识”，就会读取同一份复习进度。
- 熟词判定规则：`correct_count >= 10`。

## 当前页面

- [review.html](/Users/levelee/Documents/CodeX_co/EngLearning/review.html)
  支持拼写复习、结果弹窗、键盘操作、多端同步。
- [words.html](/Users/levelee/Documents/CodeX_co/EngLearning/words.html)
  支持查看词库、搜索、筛选待复习/熟词/高错词。
