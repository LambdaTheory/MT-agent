import type { AgentToolDefinition } from './tool.js';

const noArgumentsSchema = { type: 'object', additionalProperties: false };
const optionalReportDateArgumentsSchema = { type: 'object', properties: { date: { type: 'string' } }, additionalProperties: false };
const keywordArgumentsSchema = { type: 'object', properties: { keyword: { type: 'string' }, date: { type: 'string' } }, required: ['keyword'], additionalProperties: false };
const productRankingArgumentsSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const inventoryStatusQueryArgumentsSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const problemProductsArgumentsSchema = {
  type: 'object',
  properties: {
    problemType: { type: 'string', enum: ['low_exposure', 'weak_conversion', 'high_potential', 'new_product_pool', 'recommended_action'] },
  },
  required: ['problemType'],
  additionalProperties: false,
};
const optionalSendToArgumentsSchema = {
  type: 'object',
  properties: { sendTo: { type: 'string' } },
  additionalProperties: false,
};
const optionalDashboardRefreshArgumentsSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    sendTo: { type: 'string' },
  },
  additionalProperties: false,
};
const productIdArgumentsSchema = {
  type: 'object',
  properties: { productId: { type: 'string' } },
  required: ['productId'],
  additionalProperties: false,
};
const tenancySetArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    days: { type: 'string' },
  },
  required: ['productId', 'days'],
  additionalProperties: false,
};
const specAddAndRefreshArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    itemTitle: { type: 'string' },
  },
  required: ['productId', 'itemTitle'],
  additionalProperties: false,
};
const specRemovePlanArgumentsSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    keyword: { type: 'string' },
  },
  required: ['query', 'keyword'],
  additionalProperties: false,
};
const refreshActivityPlanArgumentsSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    maxCandidates: { type: 'number' },
  },
  additionalProperties: false,
};
const rentalPriceChangeArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    fields: { type: 'object' },
    discount: { type: 'number' },
    scope: { type: 'string', enum: ['rent_fields', 'all_price_fields'] },
  },
  required: ['productId'],
  additionalProperties: false,
};
const rentalPriceRollbackArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    taskId: { type: 'string' },
    rollbackFile: { type: 'string' },
  },
  minProperties: 1,
  additionalProperties: false,
};
const newLinkBatchPlanArgumentsSchema = {
  type: 'object',
  properties: {
    keyword: { type: 'string' },
    count: {},
    sourceProductId: { type: 'string' },
    items: { type: 'array' },
  },
  minProperties: 1,
  additionalProperties: false,
};
const rentalOperationArgumentsSchema = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    productId: { type: 'string' },
    days: { type: 'string' },
    itemTitle: { type: 'string' },
    query: { type: 'string' },
    keyword: { type: 'string' },
    sameSkuGroupId: { type: 'string' },
    items: { type: 'array' },
  },
  required: ['action', 'productId'],
  additionalProperties: false,
};

const agentTools: AgentToolDefinition[] = [
  {
    name: 'system.help',
    description: '显示飞书机器人帮助信息和当前可用能力说明',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.latestSummary',
    description: '查询最新公域日报概况',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: optionalReportDateArgumentsSchema,
  },
  {
    name: 'product.query',
    description: '按商品 ID、平台 ID 或商品名查询单个或多个商品表现。不要用于“同款组里哪条最好/最好的链接/最好的端内ID”这类排名问题。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: keywordArgumentsSchema,
  },
  {
    name: 'product.rankBestSameSku',
    description: '按链接维护档案解析商品名、别名、端内ID或同款组，并返回同款组里公域数据表现最好的端内ID。适用于“s23最好的链接是哪条”“数据最好的 pocket3 的端内id是多少”。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: productRankingArgumentsSchema,
  },
  {
    name: 'productId.lookup',
    description: '端内 ID 与平台商品 ID 互查',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: keywordArgumentsSchema,
  },
  {
    name: 'productId.lookupCard',
    description: '打开可反复输入的端内 ID 与平台商品 ID 互查飞书卡片',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'inventory.statusOverview',
    description: '查询库存情况总览卡片，按链接档案和库存快照展示同款组库存状态',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'inventory.statusQuery',
    description: '按商品名、别名、端内 ID 或同款组查询库存情况明细卡片',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: inventoryStatusQueryArgumentsSchema,
  },
  {
    name: 'linkRegistry.overview',
    description: '查询链接档案概览与治理审计卡片',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'operationsLearning.startQuiz',
    description: '开始运营学习测验',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'operationsLearning.summary',
    description: '查看当前日报对应的运营学习测验反馈汇总',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'operationsLearning.history',
    description: '查看运营学习测验历史统计',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'agentLearning.summary',
    description: '查看 Agent 澄清、确认、取消与执行结果学习记录汇总',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'activity.differentialPricingCard',
    description: '打开差异化定价活动自动化配置卡片',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'activity.cancelDifferentialPricingCard',
    description: '打开差异化定价取消与价格回调辅助卡片',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.newLinkPool',
    description: '查询新链接池、新品池、冷启动链接的当前商品列表和维护状态',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.taskPool',
    description: '查询公域日报生成的待处理任务、优先事项和不健康链接建议',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.problemProducts',
    description: '按问题类型查询商品：low_exposure 曝光低，weak_conversion 转化差/成交少，high_potential 高潜力，new_product_pool 新品池，recommended_action 推荐动作',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: problemProductsArgumentsSchema,
  },
  {
    name: 'publicTraffic.removedLinks',
    description: '查询最近下架、移除、消失的链接',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.orderSummary',
    description: '查询订单分析、履约、发货、归还、关单相关概况',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.runReport',
    description: '生成公域流量日报，可能写入输出文件并发送飞书卡片',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.resendLatestReport',
    description: '重发最新公域流量日报卡片',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: optionalSendToArgumentsSchema,
  },
  {
    name: 'publicTraffic.pushLatestReportToGroup',
    description: '把最新公域流量日报推送到群',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.refreshDashboard',
    description: '补抓访问页/后链路数据；自动使用默认配置保存 raw，必要时重建并重发日报',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: optionalDashboardRefreshArgumentsSchema,
  },
  {
    name: 'operations.refreshActivityPlan',
    description: '按最新或指定日期公域日报筛选近 30 天创单为 0 的 active 链接，按链接档案汇总待下架链接和补链建议。只生成计划，不直接下架或补链。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: refreshActivityPlanArgumentsSchema,
  },
  {
    name: 'closedOrder.syncFeedback',
    description: '同步关单反馈到本地状态',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'closedOrder.runObservationReport',
    description: '生成关单观察报告并写入产物',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'rental.copy',
    description: '复制租赁商品前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: productIdArgumentsSchema,
  },
  {
    name: 'rental.delist',
    description: '下架租赁商品前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: productIdArgumentsSchema,
  },
  {
    name: 'rental.tenancySet',
    description: '设置租赁商品租期前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: tenancySetArgumentsSchema,
  },
  {
    name: 'rental.specDiscover',
    description: '查看租赁商品规格前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: productIdArgumentsSchema,
  },
  {
    name: 'rental.specAddAndRefresh',
    description: '添加租赁商品规格并刷新前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: specAddAndRefreshArgumentsSchema,
  },
  {
    name: 'rental.specRemovePlan',
    description: '按商品名/端内ID/同款组和规格关键词生成规格项删除预览；只匹配规格项，不删除规格维度；命中明确后展示专用确认卡再执行。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: specRemovePlanArgumentsSchema,
  },
  {
    name: 'rental.priceChange',
    description: '生成租赁商品改价审计预览；执行前必须展示专用改价确认卡',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPriceChangeArgumentsSchema,
  },
  {
    name: 'rental.priceSnapshot',
    description: '按端内ID、商品别名或同款组读取租赁后台当前规格价格，并按 SKU 聚合平均租金。适用于“x200u 的定价情况怎么样”。这是只读查询，不用于改价。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: productRankingArgumentsSchema,
  },
  {
    name: 'rental.newLinkBatchPlan',
    description: '生成新链批量复制计划和专用确认卡；可指定 keyword/count/sourceProductId，或用 items 数组分别补链。确认前不会复制商品。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: newLinkBatchPlanArgumentsSchema,
  },
  {
    name: 'rental.priceRollback',
    description: '按改价审计任务或回滚文件回滚租赁商品价格',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPriceRollbackArgumentsSchema,
  },
  {
    name: 'rental.operationConfirmRequest',
    description: '执行租赁商品复制、下架、租期设置、规格查看或规格添加前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
    plannerVisible: false,
    inputSchema: rentalOperationArgumentsSchema,
  },
];

function cloneSchema(schema: unknown): unknown {
  return schema === undefined ? undefined : structuredClone(schema);
}

function cloneTool(tool: AgentToolDefinition): AgentToolDefinition {
  return { ...tool, inputSchema: cloneSchema(tool.inputSchema) };
}

export function listAgentTools(): AgentToolDefinition[] {
  return agentTools.map(cloneTool);
}

export function findAgentTool(name: string): AgentToolDefinition | undefined {
  const tool = agentTools.find((candidate) => candidate.name === name);
  return tool ? cloneTool(tool) : undefined;
}
