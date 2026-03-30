# EngLearning

这个目录现在用于维护一套可部署到 GitHub Pages 的英语词库与复习前端。

词库内容和学习进度已经拆层：

- `data/words.json`
  由本地维护并提交到 GitHub，作为词条内容源
- `data/dictionary.json`
  由本地维护并提交到 GitHub，作为本地辞典查询源
- `Supabase review_progress`
  由网页端读写，用于多端同步复习进度
- `Supabase vocabulary_words`
  由 GitHub Action 根据 `data/words.json` 自动同步，作为网页端词库主数据源
- `Supabase dictionary_entries`
  由 GitHub Action 根据 `data/dictionary.json` 自动同步，作为网页端辞典主数据源

## 文件说明

- [conversation_learning_rules.md](/Users/levelee/Documents/CodeX_co/EngLearning/conversation_learning_rules.md)
  当前线程的学习与复习规则文档。
- [data/words.json](/Users/levelee/Documents/CodeX_co/EngLearning/data/words.json)
  统一词库。
- [review.html](/Users/levelee/Documents/CodeX_co/EngLearning/review.html)
  复习页。
- [dictionary.html](/Users/levelee/Documents/CodeX_co/EngLearning/dictionary.html)
  本地辞典查询页。
- [words.html](/Users/levelee/Documents/CodeX_co/EngLearning/words.html)
  词库查看页。
- [site-config.js](/Users/levelee/Documents/CodeX_co/EngLearning/site-config.js)
  前端站点配置。
- [content-store.js](/Users/levelee/Documents/CodeX_co/EngLearning/content-store.js)
  前端共享内容加载器，优先从 Supabase 内容表读取词库与辞典。
- [supabase_schema.sql](/Users/levelee/Documents/CodeX_co/EngLearning/supabase_schema.sql)
  Supabase 建表与 RLS 策略。
- [.github/workflows/sync-content-to-supabase.yml](/Users/levelee/Documents/CodeX_co/EngLearning/.github/workflows/sync-content-to-supabase.yml)
  `words.json` / `dictionary.json` 提交后自动同步到 Supabase 的工作流。

## 部署结构

1. 将整个目录推到 GitHub 仓库。
2. 在 GitHub Pages 上托管静态页面。
3. 在 Supabase 中执行 [supabase_schema.sql](/Users/levelee/Documents/CodeX_co/EngLearning/supabase_schema.sql)。
4. 编辑 [site-config.js](/Users/levelee/Documents/CodeX_co/EngLearning/site-config.js)，填入：
   - `supabaseUrl`
   - `supabaseAnonKey`
   - 可选的 `defaultProfileId`
5. 在 GitHub 仓库 Secrets 中配置：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

当前 `supabase_schema.sql` 使用的是演示型匿名读写策略，适合你现在这个低安全要求的个人项目。

## 当前数据流

- 词库查看页和复习页优先从 Supabase 表 `vocabulary_words` 读取词条内容，空表或异常时回退到 `data/words.json`。
- 辞典查询页优先从 Supabase 表 `dictionary_entries` 读取辞典内容，空表或异常时回退到 `data/dictionary.json`。
- 复习进度通过 Supabase 表 `review_progress` 读取和写入。
- 当 `data/words.json` 或 `data/dictionary.json` 推到 `main` 后，GitHub Action 会把对应内容同步到 Supabase。
- 不同设备只要填写同一个“同步标识”，就会读取同一份复习进度。
- 熟词判定规则：`correct_count >= 10`。

## 当前页面

- [review.html](/Users/levelee/Documents/CodeX_co/EngLearning/review.html)
  支持拼写复习、结果弹窗、键盘操作、多端同步。
- [words.html](/Users/levelee/Documents/CodeX_co/EngLearning/words.html)
  支持查看词库、搜索、筛选待复习/熟词/高错词。
- [dictionary.html](/Users/levelee/Documents/CodeX_co/EngLearning/dictionary.html)
  支持按单词精确查询本地辞典，未命中时显示“本地辞典查无此词”。
