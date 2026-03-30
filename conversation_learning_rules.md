# 对话学习规则

## 一、目标

本线程直接作为英文学习入口。

为避免上下文遗失，涉及词汇记录、复习进度、熟词迁移时，优先读取和更新本地文件，而不是只依赖对话记忆。

当前本地数据文件为：

- `data/words.json`：生词词库与复习主文件
- `data/dictionary.json`：可查询辞典文件

## 二、输入处理规则

### 1. 用户输入句子或段落

默认按下面结构回复：

1. 整体翻译
2. 内容解析
3. 逐句解析
4. 语法解析
5. 关键短语解析
6. 关键单词解析

关键单词解析尽量包含：

- 音标
- 词性
- 中文义项
- 来源或词源
- 常见搭配、近义表达或拓展
- 如果可行，补充发音信息

并执行下面动作：

- 正常向用户返回整段解析
- 在后台提取该段落中的单词
- 将这些单词按 `data/dictionary.json` 的词条结构进行查重与补充写入
- `dictionary.json` 只保存词条解析字段，不保存上下文窗口或整段翻译

### 2. 用户输入单个单词或短语

默认按下面结构回复：

1. 基本翻译
2. 用法解析
3. 应用拓展
4. 音标或发音信息
5. 词库写入结果提示

并执行下面动作：

- 先读取 `data/words.json`
- 如果该词条尚未存在，则按当前词条结构写入 `data/words.json`
- 如果已经存在，则提示“已存在”，不重复添加
- 同时读取 `data/dictionary.json`
- 对当前单词额外触发一次“近邻词入辞典”流程：
  主动生成约 500 个近邻词并补充到 `data/dictionary.json`
  近邻词定义为：优先与当前查询词首字母相同；如果同首字母不足以满足数量或质量要求，则继续随机扩展到其他首字母单词
  这些近邻词不是从本地词池被动挑选，而是由系统主动生成候选词并按统一字段解析
  近邻词按 `dictionary.json` 字段结构保存，并在写入前查重
  当前查询词本身也应包含在这次辞典补充结果中
- `dictionary.json` 与 `words.json` 保持同字段结构
- 写入 `dictionary.json` 时必须补齐与 `words.json` 一致的字段，尤其是 `expansions` 不能留空
- 如果是系统主动扩充的辞典词条，也必须生成非空的 `expansions` 数组；缺少精确信息时，可先写入可读的通用拓展模板，后续再细化
- 写入 `dictionary.json` 时，`phonetic` 与 `origin` 也不能留空；若暂时缺少精确内容，应先写入可读的非空补位内容，后续再细化
- GitHub Action 将 `data/words.json` 与 `data/dictionary.json` 同步到 Supabase 时，按 `term` 查重；如果云端已存在同名词条，则直接用本地最新词条整体覆盖更新

### 3. 用户输入“词库复习”

执行下面流程：

1. 从 `data/words.json` 中抽取词条进行复习
2. 逐个提问，要求用户输入中文释义
3. 根据答案判断正误
4. 答对则累计 `correct_count`
5. 答错则累计 `incorrect_count`
6. 每次作答都写入 `review_history`
7. 当某词条累计答对达到 10 次时，将其视为熟词

## 三、词条字段建议

`data/words.json` 与 `data/dictionary.json` 中的每个词条尽量保留以下字段：

- `term`
- `type`
- `translation`
- `analysis`
- `phonetic`
- `origin`
- `expansions`
- `pronunciation`
- `accepted_answers`
- `added_at`
- `review.correct_count`
- `review.incorrect_count`
- `review.review_history`

当前 `data/words.json` 中没有单独的熟词文件。

熟词判定规则：

- 当 `review.correct_count >= 10` 时，视为熟词
- 否则视为未熟练词

## 四、执行约定

- 回复顺序优先级：
  先在当前对话中输出翻译与解析结果，再进行本地文件写入或更新，尽量减少用户等待内容反馈的时间。
- 单词/短语查询采用单条消息流程：
  在同一条回复中先呈现翻译与解析，再呈现本地查重、写入和结果反馈。
- 在用户可见内容顺序上，解析必须先于本地处理结果。
- 本地文件与对话记忆冲突时，以本地文件为准
- 如果词条信息暂不完整，可先落库，后续补充
- 后续词汇查询、查重、复习状态判断统一基于 `data/words.json`
- 后续辞典查询统一基于 `data/dictionary.json`
