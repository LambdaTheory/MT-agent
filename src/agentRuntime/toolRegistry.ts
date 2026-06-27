import type { AgentToolDefinition } from './tool.js';

const noArgumentsSchema = { type: 'object', additionalProperties: false };
const reportDateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const optionalReportDateArgumentsSchema = { type: 'object', properties: { date: reportDateSchema }, additionalProperties: false };
const reportPeriodSchema = { type: 'string', enum: ['1d', '7d', '30d'] };
const reportMetricSchema = {
  type: 'string',
  enum: [
    'exposure',
    'publicVisits',
    'dashboardVisits',
    'createdOrders',
    'signedOrders',
    'reviewedOrders',
    'shippedOrders',
    'createdOrderAmount',
    'signedOrderAmount',
    'reviewedOrderAmount',
    'shippedOrderAmount',
    'amount',
    'exposureVisitRate',
    'visitCreatedOrderRate',
    'visitShipmentRate',
    'custodyDays',
  ],
};
const reportSectionSchema = {
  type: 'string',
  enum: [
    'lowExposure',
    'weakClick',
    'weakConversion',
    'highPotential',
    'newProductObservation',
    'lifecycleGovernance',
    'custodyAbnormal',
    'recommendedActions',
    'newProductPool',
    'removedLinks',
  ],
};
const reportQueryFieldSchema = {
  type: 'string',
  enum: [
    ...reportMetricSchema.enum,
    'productName',
    'productId',
    'platformProductId',
    'action',
    'reason',
    'priority',
  ],
};
const reportQuerySortFieldSchema = {
  type: 'string',
  enum: [
    ...reportMetricSchema.enum,
    'productName',
    'productId',
    'platformProductId',
    'action',
    'priority',
  ],
};
const publicTrafficReportQueryArgumentsSchema = {
  type: 'object',
  properties: {
    target: { type: 'string', enum: ['summary', 'products', 'section', 'sectionCounts', 'orders', 'dataQuality', 'conclusions'] },
    date: reportDateSchema,
    period: reportPeriodSchema,
    periods: { type: 'array', minItems: 1, maxItems: 3, items: reportPeriodSchema },
    metrics: { type: 'array', minItems: 1, maxItems: 8, items: reportMetricSchema },
    productQuery: { type: 'string' },
    section: reportSectionSchema,
    sortBy: reportQuerySortFieldSchema,
    sortDirection: { type: 'string', enum: ['asc', 'desc'] },
    limit: { type: ['integer', 'string'], pattern: '^[1-9]\\d*$', minimum: 1 },
    filters: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          field: reportQueryFieldSchema,
          operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] },
          value: { type: ['string', 'number', 'boolean'] },
        },
        required: ['field', 'operator', 'value'],
        additionalProperties: false,
      },
    },
    orderPage: { type: 'string', enum: ['overview', 'delivery', 'return', 'customs', 'all'] },
    orderIndicator: { type: 'string' },
  },
  required: ['target'],
  additionalProperties: false,
};
const keywordArgumentsSchema = { type: 'object', properties: { keyword: { type: 'string' }, date: reportDateSchema }, required: ['keyword'], additionalProperties: false };
const productRankingArgumentsSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const inventoryStatusQueryArgumentsSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const positiveIntegerLikeSchema = { type: ['integer', 'string'], pattern: '^[1-9]\\d*$', minimum: 1 };
const linkRegistryResolveProductsArgumentsSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    includeUnknown: { type: 'boolean' },
  },
  required: ['query'],
  additionalProperties: false,
};
const linkRegistryResolveProductsResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after resolving a product name, alias, internal id, or same-SKU group.',
  properties: {
    status: { type: 'string' },
    query: { type: 'string' },
    sameSkuGroupId: { type: 'string' },
    productIds: { type: 'array', items: { type: 'string' }, description: 'Internal product ids resolved for follow-up tools such as rental.pricePreview.productIds.' },
    count: { type: 'integer' },
    matchText: { type: 'string' },
  },
};
const productRankingResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available to later planner steps after product.rankBestSameSku.',
  properties: {
    status: { type: 'string' },
    query: { type: 'string' },
    bestProductId: { type: 'string', description: 'Best internal product id for follow-up actions such as rental.newLinkBatchPlan.sourceProductId.' },
    sameSkuGroupId: { type: 'string' },
    date: { type: 'string' },
    best: { type: 'object' },
    ranking: { type: 'array' },
  },
};
const rentalCopyResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after a confirmed rental.copy step.',
  properties: {
    ok: { type: 'boolean' },
    productId: { type: 'string' },
    newProductId: { type: 'string', description: 'New internal product id returned by the copy operation when available.' },
  },
};
const rentalPriceChangeResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after confirmed rental.priceChange execution.',
  properties: {
    ok: { type: 'boolean' },
    productId: { type: 'string' },
    taskId: { type: 'string', description: 'Audit task id that can be used by rental.priceRollback.' },
    rollbackFile: { type: 'string', description: 'Rollback artifact path that can be used by rental.priceRollback.' },
    resultFile: { type: 'string' },
  },
};
const rentalNewLinkResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after confirmed rental.newLinkBatchPlan execution.',
  properties: {
    ok: { type: 'boolean' },
    newProductIds: { type: 'array', items: { type: 'string' } },
    completedCount: { type: 'integer' },
  },
};
const refreshActivityPlanResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after operations.refreshActivityPlan planning.',
  properties: {
    date: { type: 'string' },
    candidateCount: { type: 'integer' },
    executeRequest: { type: 'object', description: 'Hidden execution request included only inside the generated confirmation card.' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
};
const refreshActivityExecuteResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after confirmed operations.refreshActivityExecute execution.',
  properties: {
    ok: { type: 'boolean' },
    auditPath: { type: 'string' },
    delistedProductIds: { type: 'array', items: { type: 'string' } },
    newProductIds: { type: 'array', items: { type: 'string' } },
  },
};
const rentalPriceRollbackResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after confirmed rental.priceRollback execution.',
  properties: {
    ok: { type: 'boolean' },
    productId: { type: 'string' },
    taskId: { type: 'string' },
    rollbackFile: { type: 'string' },
  },
};
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
  properties: { sendTo: { type: 'string' }, date: reportDateSchema },
  additionalProperties: false,
};
const optionalDashboardRefreshArgumentsSchema = {
  type: 'object',
  properties: {
    date: reportDateSchema,
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
const refreshActivityExecuteArgumentsSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    delistProductIds: { type: 'array', minItems: 1, items: { type: 'string' } },
    newLinkItems: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          count: { type: 'integer', minimum: 1 },
          sourceProductId: { type: 'string' },
          sourceProductName: { type: 'string' },
          sameSkuGroupId: { type: 'string' },
        },
        required: ['keyword', 'count', 'sourceProductId', 'sourceProductName'],
        additionalProperties: false,
      },
    },
  },
  required: ['date', 'delistProductIds', 'newLinkItems'],
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
const rentalPricePreviewArgumentsSchema = {
  type: 'object',
  properties: {
    productIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
    fields: { type: 'object' },
    discount: { type: ['number', 'string'] },
    scope: { type: 'string', enum: ['rent_fields', 'all_price_fields'] },
  },
  required: ['productIds'],
  additionalProperties: false,
};
const rentalPricePreviewResultMetadataSchema = {
  type: 'object',
  description: 'Metadata available after price preview generation.',
  properties: {
    ok: { type: 'boolean' },
    productIds: { type: 'array', items: { type: 'string' } },
    previewCount: { type: 'integer' },
  },
};
const rentalPriceApplyArgumentsSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          fields: { type: 'object' },
          audit: { type: 'object' },
        },
        required: ['productId', 'fields'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
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
    count: positiveIntegerLikeSchema,
    sourceProductId: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          count: positiveIntegerLikeSchema,
          sourceProductId: { type: 'string' },
        },
        required: ['keyword', 'count'],
        additionalProperties: false,
      },
    },
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
    name: 'publicTraffic.conversionSummary',
    description: '查询最新或指定日期公域日报的转化率漏斗数据，包括曝光到访问率、访问到创建率、访问到发货率',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: optionalReportDateArgumentsSchema,
  },
  {
    name: 'publicTraffic.reportQuery',
    description: '通用只读日报查询工具：查询已保存公域日报中的汇总、商品明细、问题池、订单分析、数据源状态和结论。适合“访问最高前20”“各问题池多少条”“托管异常有哪些”“订单签约发货率多少”等自然语言问题。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: publicTrafficReportQueryArgumentsSchema,
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
    resultMetadataSchema: productRankingResultMetadataSchema,
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
    name: 'linkRegistry.resolveProducts',
    description: '按商品名、别名、端内ID或同款组解析链接档案，返回可供后续工具使用的端内ID列表；只做解析，不执行运营动作',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: linkRegistryResolveProductsArgumentsSchema,
    resultMetadataSchema: linkRegistryResolveProductsResultMetadataSchema,
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
    description: '重发最新或指定日期的公域流量日报卡片。指定日期时传 date=YYYY-MM-DD；不重新抓取或生成日报，只发送已有日报上下文。',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: optionalSendToArgumentsSchema,
  },
  {
    name: 'publicTraffic.pushLatestReportToGroup',
    description: '把最新或指定日期的公域流量日报推送到群。指定日期时传 date=YYYY-MM-DD；不重新抓取或生成日报，只发送已有日报上下文。',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: optionalReportDateArgumentsSchema,
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
    description: '按最新或指定日期公域日报筛选近 30 天创单为 0 的 active 链接，按链接档案汇总待下架链接和补链建议；命中安全源商品后生成执行确认卡，确认前不下架、不补链。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: refreshActivityPlanArgumentsSchema,
    resultMetadataSchema: refreshActivityPlanResultMetadataSchema,
  },
  {
    name: 'operations.refreshActivityExecute',
    description: '确认后执行活跃度刷新计划：批量下架近 30 天零创单链接，并按同款组补回新链',
    risk: 'high',
    requiresConfirmation: true,
    plannerVisible: false,
    inputSchema: refreshActivityExecuteArgumentsSchema,
    resultMetadataSchema: refreshActivityExecuteResultMetadataSchema,
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
    resultMetadataSchema: rentalCopyResultMetadataSchema,
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
    resultMetadataSchema: rentalPriceChangeResultMetadataSchema,
  },
  {
    name: 'rental.pricePreview',
    description: '按明确端内ID列表生成租赁商品改价审计预览和确认卡；不负责解析商品名或同款组，确认前不会改价',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPricePreviewArgumentsSchema,
    resultMetadataSchema: rentalPricePreviewResultMetadataSchema,
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
    resultMetadataSchema: rentalNewLinkResultMetadataSchema,
  },
  {
    name: 'rental.priceRollback',
    description: '按改价审计任务或回滚文件回滚租赁商品价格',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPriceRollbackArgumentsSchema,
    resultMetadataSchema: rentalPriceRollbackResultMetadataSchema,
  },
  {
    name: 'rental.priceApply',
    description: '执行已经预览并确认的租赁商品改价请求',
    risk: 'high',
    requiresConfirmation: true,
    plannerVisible: false,
    inputSchema: rentalPriceApplyArgumentsSchema,
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
  return {
    ...tool,
    inputSchema: cloneSchema(tool.inputSchema),
    resultMetadataSchema: cloneSchema(tool.resultMetadataSchema),
  };
}

export function listAgentTools(): AgentToolDefinition[] {
  return agentTools.map(cloneTool);
}

export function findAgentTool(name: string): AgentToolDefinition | undefined {
  const tool = agentTools.find((candidate) => candidate.name === name);
  return tool ? cloneTool(tool) : undefined;
}
