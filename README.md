# EngLearning

这个目录现在用于维护一套可部署到 GitHub Pages 的英语词库与复习前端。

词库内容和学习进度已经拆层：

- `data/words.json`
  由本地维护并提交到 GitHub，作为词条内容源
- `data/dictionary.json`
  由本地维护并提交到 GitHub，作为本地辞典查询源
- `Supabase review_progress`
  由网页端读写，用于多端同步复习进度
- `Supabase review_events`
  每次作答写入一条不可变事件，再由数据库原子更新汇总进度
- `Supabase app_users` / `app_sessions`
  保存轻量用户、审批状态、角色和登录会话；`LvE` 是唯一管理员
- `Supabase personal_vocabulary`
  保存当前登录用户从辞典加入的个人词条，不再修改公共内容表
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
- [login.html](/Users/levelee/Documents/CodeX_co/EngLearning/login.html)
  登录页。
- [register.html](/Users/levelee/Documents/CodeX_co/EngLearning/register.html)
  新用户申请页。
- [account.html](/Users/levelee/Documents/CodeX_co/EngLearning/account.html)
  个人中心与学习统计。
- [admin.html](/Users/levelee/Documents/CodeX_co/EngLearning/admin.html)
  `LvE` 用户审批与管理页。
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
4. SQL 会创建 `LvE` 管理员，初始密码为 `523`，并执行一次旧同步标识清理。
5. 编辑 [site-config.js](/Users/levelee/Documents/CodeX_co/EngLearning/site-config.js)，填入：
   - `supabaseUrl`
   - `supabaseAnonKey`
6. 在 GitHub 仓库 Secrets 中配置：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

每次更新 `supabase_schema.sql` 后需要在 Supabase SQL Editor 中重新执行。当前采用小范围轻量账号模式：密码使用哈希保存，浏览器使用随机会话令牌；短密码仍不适合开放给不受信任的公众使用。

## 用户与审批

- 未登录时只可访问登录页和新用户申请页。
- 新用户提交用户名和密码后状态为 `pending`，可登录查看等待状态，但不能使用学习功能。
- `LvE` 可在用户管理页批准、禁用、恢复、重置密码或删除用户。
- 重置后的临时密码固定为 `123`。
- 删除用户会同时删除其个人生词、复习进度和复习事件。
- 个人中心显示注册时间、上次登录、生词数、熟词数和复习统计。
- 管理后台显示用户状态、注册时间、上次登录和词库数量。

## 拉回线上复习进度

如果需要把线上复习记录导出为私有备份，可以运行：

```bash
node scripts/pull-supabase-review-progress.mjs --profile <你的profile_id>
```

默认导出到被 Git 忽略的 `data/private/review-progress-<profile>.json`。个人进度不会再写回公开的词条内容文件。

可选参数：

- `--output <path>`
  指定私有备份文件路径

脚本会优先读取：

- `site-config.js` 里的 `supabaseUrl`、`supabaseAnonKey`、`reviewProgressTable`
- 或环境变量 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`REVIEW_PROGRESS_TABLE`

## 更新词库或辞典

每次修改 `data/words.json` 或 `data/dictionary.json` 后，必须重建页面使用的静态统计和辞典分片：

```bash
node scripts/build_dictionary_prefixes.js
```

这个脚本会同步更新：

- `site-config.js` 里的 `contentStats`
- `data/dictionary-prefix/`
- `data/dictionary-suggest/`
- `data/dictionary-detail/`

提交前可以运行校验：

```bash
node scripts/build_dictionary_prefixes.js --check
```

完整项目校验：

```bash
npm run check
```

本仓库包含 `.githooks/pre-commit`，启用后会在提交涉及内容数据时自动运行上述校验：

```bash
git config core.hooksPath .githooks
```

GitHub Action 在同步 Supabase 前也会运行同样校验，防止统计或分片落后于主数据文件。

## 当前数据流

- `words.json` 与 `dictionary.json` 只保存公共词条内容，不再包含个人 `review` 字段。
- `vocabulary_words` / `data/words.json` 是 `LvE` 的基础词库；普通用户初始词库为空，只读取自己的 `personal_vocabulary`。
- 辞典查询页优先从 Supabase 表 `dictionary_entries` 读取辞典内容，未命中或异常时按首字母读取本地分片，避免移动端加载完整 `data/dictionary.json`。
- 作答通过带登录令牌的 `record_my_review_event` 原子函数写入 `review_events` 并更新当前用户的 `review_progress`。
- 断网时作答先进入浏览器本地队列，恢复网络后自动补传。
- 当 `data/words.json` 或 `data/dictionary.json` 推到 `main` 后，GitHub Action 会把对应内容同步到 Supabase。
- GitHub Action 按 `term` 做同步查重；如果 Supabase 中已存在同名词条，则直接用本地 JSON 的最新 `payload` 覆盖更新。
- 同一用户在不同设备登录后会读取同一份生词本与复习进度。
- 熟词判定规则：`correct_count >= 10`。

## 当前页面

- [review.html](/Users/levelee/Documents/CodeX_co/EngLearning/review.html)
  支持拼写复习、单选、标点短语、结果弹窗、键盘操作、离线队列与多端同步。
- [words.html](/Users/levelee/Documents/CodeX_co/EngLearning/words.html)
  支持查看词库、搜索、筛选待复习/熟词/高错词。
- [dictionary.html](/Users/levelee/Documents/CodeX_co/EngLearning/dictionary.html)
  支持按单词精确查询本地辞典，未命中时显示“本地辞典查无此词”。
