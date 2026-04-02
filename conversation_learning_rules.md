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

其中“基本翻译”应尽量直接标注词性，常见格式例如：

- `pattern`：模式；图案；范例（名词 N）
- `validate`：验证；证实（动词 V）
- `strategic`：战略性的；关键性的（形容词 Adj）
- `carefully`：仔细地；谨慎地（副词 Adv）

如果一个词有多个常见词性，应按主要用法同时标出，例如：

- `review`：审查；复习（名词 N / 动词 V）

并执行下面动作：

- 先读取 `data/words.json`
- 如果该词条尚未存在，则按当前词条结构写入 `data/words.json`
- 如果已经存在，则提示“已存在”，不重复添加
- 同时读取 `data/dictionary.json`
- 当前查询词仍严格按原规则处理：先在线程中给出翻译解析，再对 `words.json` 与 `dictionary.json` 做查重和更新
- 对当前单词额外触发一次“近邻词入辞典”流程：
  主动生成约 500 个近邻词并补充到 `data/dictionary.json`
  近邻词定义为：优先与当前查询词首字母相同；如果同首字母不足以满足数量，则继续随机扩展到其他首字母单词
  每个近邻词都必须先在本地 `data/DICT` 中命中；只有 `DICT` 中命中的近邻词，才允许写入 `dictionary.json`
  命中后，应优先采信 `DICT` 中的单词解析内容来覆盖对应字段
  若某个近邻词在 `DICT` 中没有找到，则直接放弃，不写入
  命中的近邻词按 `dictionary.json` 字段结构保存，并在写入前查重
  当前查询词本身也应包含在这次辞典补充结果中
- `dictionary.json` 与 `words.json` 保持同字段结构
- 写入 `dictionary.json` 时必须补齐与 `words.json` 一致的字段，尤其是 `expansions` 不能留空
- 如果是系统主动扩充的辞典词条，也必须生成非空的 `expansions` 数组；缺少精确信息时，可先写入可读的通用拓展模板，后续再细化
- `words.json` 中的词条应优先保证 `phonetic` 与 `origin` 的真实性
- `dictionary.json` 中若词条尚未经过真实查验，则 `phonetic` 与 `origin` 统一写为 `待查`
- 只有当词条已经进入 `words.json` 或被单独做过真实查验时，才将真实 `phonetic` 与 `origin` 回写到 `dictionary.json`
- 即使是近邻扩充词条，`translation`、`analysis`、`expansions`、`accepted_answers` 也必须是可读内容，不能使用“待补全”之类占位字样
- 后续新添的近邻词条，应尽量为所有字段生成清晰解释；包括 `translation`、`analysis`、`expansions`、`accepted_answers`，以及尽量可读的 `phonetic`、`origin`
- 只有在确实无法可靠生成时，才允许将 `phonetic` 或 `origin` 标为 `待查`，并应尽量减少这种情况
- 近邻词扩充遵循“质量优于数量”原则：如果无法为某个近邻词生成足够具体、可查询的 `translation`、`analysis`、`expansions`，则不要为了凑数量写入该词条
- 不允许仅凭后缀或通用模板生成过于空泛的释义；近邻词条应尽量达到可直接查询使用的质量
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
- `pos`
- `senses`
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

其中：

- `pos` 用于保存词性信息
- 建议使用简洁标注，如 `N`、`V`、`Adj`、`Adv`
- 如果有多个常见词性，必须明确标注，不可省略
- 多词性默认采用统一字符串格式保存，例如：`N / V`、`Adj / N`
- 呈现给用户时，也应按同样格式直接展示在翻译行中
- 词性顺序尽量按主要常见用法在前、次要用法在后
- 如果一个词在不同词性下有不同中文义项，应新增 `senses` 字段保存分词性释义
- `senses` 建议为数组结构，例如：
  - `{ "pos": "N", "translation": "审查；复习；评论" }`
  - `{ "pos": "V", "translation": "审查；复查；复习" }`
- `pos` 保留总览值，如 `N / V`
- `translation` 保留该词的高频总述或合并义项
- 具体分词性差异以 `senses` 为准

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
