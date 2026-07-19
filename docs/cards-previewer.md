# 飞书卡片样式预览流程

本文档记录 MT-agent 卡片样式迭代时，如何把设计版本发送到个人飞书中观察效果。目标是在不影响 `master` 和线上 PM2 进程的前提下，用真实飞书渲染结果确认卡片是否满意。

## 适用场景

- 需要调整飞书卡片的信息层级、颜色、标签、按钮布局、折叠策略或文案密度。
- 需要让使用者在真实飞书客户端中观察效果，而不是只看 JSON 或代码描述。
- 需要预览审批卡、确认卡、日报卡、库存卡等包含较多信息的卡片。
- 当前 PM2 正在跑 `master`，但卡片设计需要先在独立 worktree 中验证。

## 职责边界

`lark-card-designer` 只负责卡片设计判断：信息架构、首屏重点、组件选择、颜色语义、交互状态和验收清单。它不负责发送飞书、不生成最终生产 JSON、不写 API 调用和 callback 处理。

项目实现侧负责把设计转成可发送的项目卡片结构，并通过现有 `sendFeishuCard` 通道发送给个人飞书预览。

## 标准流程

1. 在独立 worktree 中做预览分支，不直接改 `master`。

```powershell
git worktree add C:\works\MT-agent\.worktrees\approval-card-preview -b codex/approval-card-preview master
Set-Location C:\works\MT-agent\.worktrees\approval-card-preview
```

如果 worktree 已存在，直接进入对应目录即可。

```powershell
Set-Location C:\works\MT-agent\.worktrees\approval-card-preview
```

2. 调用 `lark-card-designer` 做设计决策，先确定卡片的首屏重点、数据密度、颜色语义和按钮状态。

3. 在 worktree 中实现或临时构造预览卡片，预览 JSON 建议保存到 `output/card-previews/`。

4. 使用一次性临时脚本把卡片发送到个人飞书。发送目标固定为 `personal`，不要发群。

```powershell
npx tsx .\.tmp-send-card-preview.ts
```

5. 观察命令输出，成功时通常应看到类似结果。

```json
{
  "sent": true,
  "channel": "app"
}
```

6. 删除临时发送脚本，保留 `output/card-previews/*.json` 作为设计历史或对比材料。

7. 使用者在飞书里给出修改意见，继续在同一个 worktree 中迭代并重复发送预览。

8. 样式确认后，再把被认可的改动落实到实际源码，测试通过后合并到 `master`，最后按需重启 PM2。

## 临时发送脚本模板

在 worktree 根目录创建 `.tmp-send-card-preview.ts`，发送完成后删除。下面模板适合直接改造成某张卡片的预览脚本。

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadEnv } from './src/config/loadEnv.js';
import { sendFeishuCard } from './src/notify/feishu.js';

const outputPath = 'output/card-previews/example-card-preview-v1.json';

function buildPreviewCard(): Record<string, unknown> {
  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'orange',
      title: {
        tag: 'plain_text',
        content: '审批卡片样式预览 V1',
      },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: '**待审批：DJI Pocket 3 租赁价格调整**\n请确认 4 个商品的价格变更，预览按钮不会触发真实动作。',
        },
        {
          tag: 'hr',
        },
        {
          tag: 'markdown',
          content: '**653｜DJI Pocket 3 标准版**\n降价 <font color=green>29.00 -> 26.90</font>，预计影响 7 日租赁转化观察。',
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '预览通过',
              },
              type: 'primary',
              value: {
                action: 'card_preview_noop',
                preview: true,
              },
            },
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '继续调整',
              },
              value: {
                action: 'card_preview_noop',
                preview: true,
              },
            },
          ],
        },
      ],
    },
  };
}

const card = buildPreviewCard();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(card, null, 2), 'utf8');

await loadEnv('C:/works/MT-agent/.env');
const result = await sendFeishuCard(
  { ...process.env, FEISHU_SEND_TO: 'personal' },
  card,
  '飞书卡片样式预览',
);

console.log(JSON.stringify(result, null, 2));
if (!result.sent) {
  process.exitCode = 1;
}
```

如果要预览真实业务构造函数，优先在临时脚本中导入对应 `buildXxxCard`，再填入具体样例数据。样例数据不要使用 `?` 占位，尽量写成真实业务会出现的商品名、价格、库存、日期和审批原因。

## Worktree 与 PM2 的关系

PM2 默认仍然运行 `master` 目录里的代码。预览脚本是在 worktree 中启动的一次性 Node 进程，只会加载当前 worktree 的源码，不会替换 PM2 进程，也不会影响线上机器人行为。

预览期间不要重启 PM2。只有当使用者明确认可某个版本，并且改动已经合并回 `master` 后，才进入重启流程。

## 预览安全规则

- 发送目标固定使用 `{ ...process.env, FEISHU_SEND_TO: 'personal' }`，除非使用者明确要求发群。
- 预览按钮必须是 no-op，`value` 中建议带上 `preview: true` 和类似 `card_preview_noop` 的动作名。
- 不要复用真实审批、确认、删除、下架、改价等 callback action。
- 不要在预览脚本里写入生产数据、调用真实执行接口或触发持久化状态变更。
- 临时脚本发送完成后删除，避免后续误运行。
- 可以保留 `output/card-previews/*.json`，便于回看版本差异。

## 样式验收清单

- 首屏第一眼能看出这张卡要读者做什么判断或动作。
- 大量信息不堆在首屏，长列表优先 Top-N、分组、折叠或摘要后置。
- 颜色只表达语义，不做装饰；默认优先使用飞书原生中性色。
- 降价、涨价等变化不能只靠颜色表达，文案中也要写明“降价”或“涨价”。
- 绿色、红色尽量低饱和、局部使用，不给整段正文或大面积背景上色。
- 专业审批和 Agent 卡片不使用表情符号，不使用过度活泼的标题。
- 按钮主次明确，危险动作只有在真实高风险场景才使用强警示样式。
- 卡片底部保留必要来源、时间、runId、decisionId 或 requestRef 等审计信息。
- 手机端可读，字段不要过宽，表格列数要受控。

## 合并与上线边界

预览通过不等于已经上线。正式上线应按下面顺序处理。

1. 将被认可的样式改动落实到实际源码中。
2. 运行相关单元测试或至少运行对应卡片构造函数的轻量校验。
3. 确认 `git diff` 只包含本次卡片样式相关改动。
4. 合并回 `master`。
5. 在 `master` 上重启 PM2，让生产机器人加载新代码。

这套流程的核心原则是：设计预览可以快，生产切换要慢。先让使用者在个人飞书里看见真实效果，认可后再合并和重启。
