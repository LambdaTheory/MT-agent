# 链接档案候选同款组审核流设计

## 背景

当前链接档案已经能把现有商品链接沉淀成统一 registry，并支持：

- 端内 ID / 平台商品 ID 基础映射
- `resolveAlias()` 模糊别名解析
- `listBySameSkuGroup()` 同款组查询
- `audit()` 审计与风险输出

截至 2026-06-23，本地审计结果显示：

- 总链接 `357`
- `active` `355`
- `unknown` `2`
- 风险项 `446`

风险的主要来源不是脏数据，而是“档案结构化整理尚未完成”：

- `classification_unknown` `357`
- `sample_insufficient` `88`
- `alias_duplicate_hit` `1`

也就是说，底层链接已入档，但 `category / productType / shortName / sameSkuGroupId / aliases` 这层尚未进入可运营、可审计、可稳定供 Agent 使用的状态。

用户已明确要求第一阶段优先做“准确率优先”的整理，不追求一次性覆盖全部长尾，不让 Agent 依赖 LLM 猜商品名；并选择采用：

1. 规则预归并
2. 人工按“候选同款组”为单位审核
3. 审核通过后再落正式 override

## 目标

- 基于现有 registry 自动生成“候选同款组审核清单”
- 让人工审核单位从“单条链接”提升为“候选同款组”
- 将人工审核结论结构化保存，避免直接手改正式 override
- 审核通过后可稳定生成正式 `link-registry-overrides`
- 让后续 Agent / 飞书卡片 / 审计都基于人工定版结果工作

## 非目标

- 不在第一阶段直接精修 357 条每一条链接
- 不实现飞书内交互式审核工作流
- 不构建完整运营后台
- 不追求第一轮就把所有长尾商品全部归类完成
- 不在没有人工确认的前提下自动写入正式 override

## 总体方案

整理流程分为四段：

1. 从现有 link registry 读取链接档案
2. 通过保守规则生成“候选同款组”
3. 输出“人工审核清单”
4. 人工确认后，将审核结果转换为正式 override

整体数据流如下：

```text
link registry entries
  -> candidate grouping rules
  -> candidate review list
  -> human review decisions
  -> override materialization
  -> rebuilt registry + audit
```

这里的关键边界是：

- 候选组只是“建议”，不是正式分组
- 正式分组只来自人工审核后的结果
- 审核清单和正式 override 必须是两个独立产物

## 候选同款组生成规则

### 1. 强规则

命中后可直接形成高置信候选组：

- 现有 `sameSkuGroupId` 一致
- 名称归一后完全一致
- 去品牌、去空格、大小写归一后核心型号一致
- 已有手工短名一致
- 已有 alias 归一后命中同一主名

典型例子：

- `Ace Pro 2`
- `AcePro2`
- `ace pro 2`

### 2. 中规则

命中后生成“需人工确认”的候选组：

- 同品牌 + 同核心型号 + 套装词不同
- 中文名 / 英文名混写但核心型号一致
- 容量词、颜色词、版本词不同
- 主商品与标准版 / 套装版 / Creator 版相近

典型例子：

- `DJI Pocket 3`
- `DJI Pocket 3 Creator Combo`
- `DJI Pocket 3 全能套装`

### 3. 拦截规则

以下情况默认不自动并组，只能进入人工裁决：

- 品牌不同
- 代际不同，如 `Ace Pro` 和 `Ace Pro 2`
- 核心型号不同但描述词接近
- 主商品与配件、机身、镜头、套餐疑似混淆
- 名称只有泛词重叠，如“相机”“套餐”“全能版”

### 4. 设计原则

- 高精度优先，低召回可接受
- 第一轮宁可少并，不要误并
- 每个候选组必须保留“成组原因”，供人工审核使用

## 候选同款组审核清单

人工审核清单采用结构化文件，建议 JSON。每条记录对应一个候选同款组，而不是单条链接。

### 审核清单字段

- `candidateGroupKey`
  候选组临时唯一键
- `proposedSameSkuGroupId`
  程序建议的正式同款组 ID
- `proposedShortName`
  程序建议的短名
- `aliases`
  程序提取出的候选别名
- `confidence`
  `high / medium / low`
- `priority`
  `P1 / P2 / P3`
- `reasons`
  成组原因列表，如 `normalized_name_match`
- `entries`
  候选组内全部链接
- `reviewDecision`
  初始为空，由人工填写
- `reviewNotes`
  人工备注

### 候选组内每条链接字段

- `internalProductId`
- `platformProductId`
- `productName`
- `shortName`
- `status`
- `source`
- `firstSeenDate`
- `updatedAt`

### 人工可选结论

- `accept`
  完全接受建议
- `accept_with_edit`
  接受，但人工修改正式组信息
- `split`
  这组误并，需要拆分
- `reject`
  不形成同款组
- `defer`
  暂缓处理

### 优先级排序

审核清单默认按以下顺序输出：

1. `P1`
   高置信且高价值的候选组
2. `P2`
   中置信、会明显影响名称解析准确率的候选组
3. `P3`
   长尾与孤儿组

优先级计算第一阶段建议结合以下信号：

- 同组样本数较多
- 最近活跃 (`active`) 链接较多
- 名称冲突风险较高
- 影响常见商品解析

## 正式 override 落地方式

审核清单不是正式配置，正式配置仍落到现有 override 合同中。

### `accept`

生成：

- `entries[].sameSkuGroupId`
- `entries[].shortName`
- `entries[].aliases`
- 必要时 `categoryId / categoryName / productType`

### `accept_with_edit`

以人工填写结果覆盖程序建议，再生成正式 override。

### `split`

不直接写正式组；拆分结果需在审核文件中显式给出子组信息，之后再转换为多条 override。

### `reject`

不生成组 override；如有必要，可只保留单条链接 short name 修正。

### `defer`

不生成正式 override，保留在下一轮审核清单。

## 产物设计

第一阶段建议新增两类产物：

### 1. 候选审核清单

建议路径：

- `output/link-registry-review/link-registry-review-candidates-YYYY-MM-DD.json`

责任：

- 面向人工审核
- 可重复生成
- 不参与正式运行时查询

### 2. 审核结果文件

建议路径：

- `config/link-registry-review-decisions.json`

责任：

- 记录人工审核结论
- 作为正式 override 物料化的输入

### 3. 正式 override

现有路径：

- `config/link-registry-overrides.json`

责任：

- 运行时唯一正式人工覆盖来源

## 组件拆分建议

第一阶段实现建议拆成以下单元：

- `candidate grouping`
  负责从 registry 生成候选组
- `review list formatter`
  负责输出审核清单
- `decision parser`
  负责读取人工审核结果
- `override materializer`
  负责将审核结果转换为正式 override
- `audit summary`
  负责比较整理前后的风险下降情况

这样后续即使审核方式从 JSON 变成飞书表单或后台页面，核心逻辑也不需要重写。

## 错误处理

- 候选组生成失败时，不写部分损坏文件
- 审核结果字段非法时，停止 materialization，并明确指出出错组
- `split` 但未提供拆分结果时，不生成 override
- 审核结果引用了不存在的 `candidateGroupKey` 时，报错
- 生成的 override 若引入重复冲突，保留现有审计风控并阻止落地

## 测试要求

至少覆盖以下场景：

- 完全相同型号的强规则归并
- 套装差异引发的中规则候选组
- 代际不同商品被拦截，不自动并组
- 审核清单字段完整输出
- `accept` 正确物料化为 override
- `accept_with_edit` 以人工值覆盖程序建议
- `split` 不会错误写成一个组
- 非法审核结果被拒绝
- 物料化后重建 registry，`classification_unknown` 与 `sample_insufficient` 能被量化观察

## 验收标准

- 可以从现有 registry 稳定生成候选同款组审核清单
- 人工审核单位是“候选组”，不是“单条链接”
- 人工审核结论可以被程序稳定读取
- 程序能将审核结论转换为正式 override
- 新的 override 被 link registry 正常消费
- 整理前后的风险变化可通过 `audit()` 对比
- 整个流程中 Agent 不需要猜商品名，只依赖正式 link registry 结果

## 推荐实施顺序

1. 先实现候选同款组生成
2. 再实现审核清单导出
3. 再实现审核结果读取与 override 物料化
4. 最后补“前后审计对比”和操作文档

这样第一轮就能尽快拿到可人工审核的数据，不必等整条链全部做完才开始整理。
