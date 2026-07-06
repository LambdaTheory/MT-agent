import type { AgentToolDefinition } from './tool.js';

const noArgumentsSchema = { type: 'object', additionalProperties: false };
const reportDateSchema = { type: 'string', pattern: '^(?:\\d{4}-\\d{2}-\\d{2}|\\d{2,4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}|\\d{1,2}月\\d{1,2}日)$' };
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
const reportAggregationSchema = { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] };
const reportSourceSchema = { type: 'string', enum: ['exposure', 'dashboard', 'all'] };
const reportCoverageStatusSchema = { type: 'string', enum: ['available', 'missing', 'all'] };
const reportOrderDerivedMetricSchema = { type: 'string', enum: ['shipmentRate', 'closeRate', 'closeRateStatus', 'averageOrderValue', 'fulfillmentRates', 'all'] };
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
    'maintenanceStatus',
    'stock',
    'skuCount',
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
    'maintenanceStatus',
    'stock',
    'skuCount',
  ],
};
const publicTrafficReportQueryArgumentsSchema = {
  type: 'object',
  properties: {
    target: { type: 'string', enum: ['summary', 'comparison', 'dateComparison', 'products', 'productDetail', 'productAggregation', 'sourceCoverage', 'section', 'sectionCounts', 'orders', 'orderDerived', 'dataQuality', 'conclusions'] },
    date: reportDateSchema,
    compareDate: reportDateSchema,
    compareWith: { type: 'string', enum: ['previousDay', 'previousPeriod'] },
    period: reportPeriodSchema,
    periods: { type: 'array', minItems: 1, maxItems: 3, items: reportPeriodSchema },
    metrics: { type: 'array', minItems: 1, maxItems: 16, items: reportMetricSchema },
    productQuery: { type: 'string' },
    section: reportSectionSchema,
    aggregation: reportAggregationSchema,
    source: reportSourceSchema,
    coverageStatus: reportCoverageStatusSchema,
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
    orderDerivedMetric: reportOrderDerivedMetricSchema,
  },
  required: ['target'],
  additionalProperties: false,
};
const keywordArgumentsSchema = { type: 'object', properties: { keyword: { type: 'string' }, date: reportDateSchema }, required: ['keyword'], additionalProperties: false };
const productRankingArgumentsSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    metric: { type: 'string', enum: ['shippedOrders', 'amount', 'exposure'] },
    periodDays: { type: ['integer', 'string'], enum: [1, 7, 30, '1', '7', '30'] },
  },
  required: ['query'],
  additionalProperties: false,
};
const positiveIntegerLikeSchema = { type: ['integer', 'string'], pattern: '^[1-9]\\d*$', minimum: 1 };
const categoryRankingArgumentsSchema = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    metric: { type: 'string', enum: ['shippedOrders', 'amount', 'exposure'] },
    periodDays: { type: ['integer', 'string'], enum: [1, 7, 30, '1', '7', '30'] },
    limit: positiveIntegerLikeSchema,
  },
  required: ['metric', 'periodDays'],
  additionalProperties: false,
};
const inventoryStatusQueryArgumentsSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const linkRegistryResolveProductsArgumentsSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    includeUnknown: { type: 'boolean' },
    resolutionMode: { type: 'string', enum: ['single', 'sameSkuGroup'] },
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
    resolutionMode: { type: 'string' },
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
    shownCandidateCount: { type: 'integer' },
    skipped: {
      type: 'object',
      properties: {
        inactive: { type: 'integer' },
        missingRow: { type: 'integer' },
        missing30dDashboard: { type: 'integer' },
        onlineLessThan30d: { type: 'integer' },
        onlineDaysUnknown: { type: 'integer' },
      },
    },
    executeRequest: { type: 'object', description: 'Deprecated direct execution request; refreshActivityPlan now returns strategyRequests for strategy choice cards.' },
    strategyRequests: { type: 'object', description: 'Hidden strategy-specific execution requests for delist_only and delist_and_refill choices.' },
    blockers: { type: 'array', items: { type: 'string' } },
    skippedGroups: { type: 'array', items: { type: 'string' } },
    scope: { type: ['string', 'null'] },
    zeroMetric: { type: 'string', enum: ['created_orders', 'amount'] },
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
const windowedFindingsArgumentsSchema = {
  type: 'object',
  properties: {
    lookbackDays: positiveIntegerLikeSchema,
    predicate: { type: 'string', enum: ['exposure_without_orders'] },
    endDate: reportDateSchema,
  },
  required: ['lookbackDays', 'predicate'],
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
const rentalDelistArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string', description: 'Single internal product id, or a comma/newline separated list for batch delist compatibility.' },
    productIds: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'string' }, description: 'Internal product ids to delist in one confirmed batch.' },
  },
  minProperties: 1,
  additionalProperties: false,
};
const rentalDelistBatchArgumentsSchema = {
  type: 'object',
  properties: {
    productIds: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'string' } },
  },
  required: ['productIds'],
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
    specDimId: { type: 'string' },
    itemTitle: { type: 'string' },
  },
  required: ['productId', 'specDimId', 'itemTitle'],
  additionalProperties: false,
};
const specAddItemArgumentsSchema = specAddAndRefreshArgumentsSchema;
const applyCurrentArgumentsSchema = {
  type: 'object',
  properties: {
    expectedProductId: { type: 'string' },
    changes: { type: 'object', additionalProperties: true },
  },
  required: ['expectedProductId', 'changes'],
  additionalProperties: false,
};
const submitCurrentArgumentsSchema = {
  type: 'object',
  properties: { expectedProductId: { type: 'string' } },
  required: ['expectedProductId'],
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
const rentalPlatformSearchArgumentsSchema = {
  type: 'object',
  properties: {
    keyword: { type: 'string' },
  },
  required: ['keyword'],
  additionalProperties: false,
};
const rentalPlatformSearchAllArgumentsSchema = {
  type: 'object',
  properties: {
    limit: { type: ['integer', 'string'], pattern: '^[1-9]\\d*$', minimum: 1, maximum: 200 },
  },
  additionalProperties: false,
};
const rentalBatchReadArgumentsSchema = {
  type: 'object',
  properties: {
    productIds: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'string' } },
  },
  required: ['productIds'],
  additionalProperties: false,
};
const rentalBatchSpecFileArgumentsSchema = {
  type: 'object',
  properties: { specFile: { type: 'string' } },
  required: ['specFile'],
  additionalProperties: false,
};
const rentalBatchExecuteArgumentsSchema = {
  type: 'object',
  properties: { specFile: { type: 'string' }, confirmFormSetupWithoutPreview: { type: 'boolean' } },
  required: ['specFile'],
  additionalProperties: false,
};
const rentalBatchStateFileArgumentsSchema = {
  type: 'object',
  properties: { stateFile: { type: 'string' } },
  required: ['stateFile'],
  additionalProperties: false,
};
const rentalBatchRollbackArgumentsSchema = {
  type: 'object',
  properties: { stateFile: { type: 'string' }, confirm: { type: 'boolean' } },
  required: ['stateFile'],
  additionalProperties: false,
};
const rentalMirrorKeywordArgumentsSchema = {
  type: 'object',
  properties: { keyword: { type: 'string' } },
  required: ['keyword'],
  additionalProperties: false,
};
const rentalReadRawArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    fields: { type: 'array', maxItems: 32, items: { type: 'string' } },
  },
  required: ['productId'],
  additionalProperties: false,
};
const refreshActivityPlanArgumentsSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    maxCandidates: { type: 'number' },
    query: { type: 'string' },
    sameSkuGroupId: { type: 'string' },
    zeroMetric: { type: 'string', enum: ['created_orders', 'amount'] },
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
      minItems: 0,
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
    strategy: { type: 'string', enum: ['delist_only', 'delist_and_refill'] },
  },
  required: ['date', 'delistProductIds'],
  additionalProperties: false,
};
const rentalPriceChangeArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    fields: { type: 'object' },
    discount: { type: 'number', description: 'Explicit multiplier only. Use 0.8 for 8-fold, 1.8 for 180%; never use bare fold numbers such as 8.' },
    adjustmentAmount: { type: ['number', 'string'], description: 'Absolute amount to add to every rental price field. Use negative values such as -1 to subtract 1 yuan.' },
    scope: { type: 'string', enum: ['rent_fields', 'all_price_fields'], description: '兼容旧参数；倍数/折扣类改价会被强制限制为 rent_fields。非租金字段必须用 fields 精准点名。' },
  },
  required: ['productId'],
  additionalProperties: false,
};
const rentalPricePreviewArgumentsSchema = {
  type: 'object',
  properties: {
    productIds: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string' } },
    fields: { type: 'object' },
    discount: { type: ['number', 'string'], description: 'Explicit multiplier only. Use 0.8 for 8-fold, 1.8 for 180%; never use bare fold numbers such as 8.' },
    adjustmentAmount: { type: ['number', 'string'], description: 'Absolute amount to add to every rental price field. Use negative values such as -1 to subtract 1 yuan.' },
    scope: { type: 'string', enum: ['rent_fields', 'all_price_fields'], description: '兼容旧参数；倍数/折扣类改价会被强制限制为 rent_fields。非租金字段必须用 fields 精准点名。' },
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
const rentalPerSpecPricePlanArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    specPrices: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          specId: { type: 'string' },
          fields: { type: 'object', description: 'Absolute price fields for this specId, e.g. { rent1day: "80.00" }. Relative calculation must happen before calling this tool.' },
        },
        required: ['specId', 'fields'],
        additionalProperties: false,
      },
    },
  },
  required: ['productId', 'specPrices'],
  additionalProperties: false,
};
const rentalPerSpecPriceApplyArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    specFields: { type: 'object', description: 'Nested absolute price changes keyed by specId: { specId: { field: value } }.' },
  },
  required: ['productId', 'specFields'],
  additionalProperties: false,
};
const rentalSpecDimArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    action: { type: 'string', enum: ['add', 'remove'] },
    title: { type: 'string', description: 'Required when action is add.' },
    specDimId: { type: 'string', description: 'Required when action is remove.' },
  },
  required: ['productId', 'action'],
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
    fallbackSourceProductIds: { type: 'array', items: { type: 'string' } },
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
        required: ['count'],
        minProperties: 2,
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
    description: '通用只读日报查询工具：查询已保存公域日报中的汇总、商品明细、问题池、订单分析、数据源状态和结论。适合“访问最高前20”“各问题池多少条”“托管异常有哪些”“失活/生命周期治理候选有哪些”“订单签约发货率多少”等自然语言问题。不用于“某商品有多少条链接/有哪些端内ID”这类链接档案总数问题。',
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
    description: '按链接维护档案解析商品名、别名、端内ID或同款组，并返回同款组里公域数据表现最好的端内ID。适用于“s23最好的链接是哪条”“数据最好的 pocket3 的端内id是多少”“近30天金额最好的 r50 是哪条”。metric 支持 shippedOrders/amount/exposure，periodDays 支持 1/7/30。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: productRankingArgumentsSchema,
    resultMetadataSchema: productRankingResultMetadataSchema,
  },
  {
    name: 'product.rankByCategory',
    description: '按链接档案里的品类/类型筛选商品，并按公域日报指标排名。metric 支持 shippedOrders/amount/exposure，periodDays 支持 1/7/30。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: categoryRankingArgumentsSchema,
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
    name: 'linkRegistry.maintenancePrompt',
    description: '主动呼出链接维护提醒卡片，用于逐条补齐链接档案里的短名、同款组、品类、商品类型等维护信息。适用于“链接维护”“打开链接维护卡”“我要维护链接档案”。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'linkRegistry.governancePrompt',
    description: '主动呼出组级治理提醒卡片，用于处理同款组样本不足、人工 override 风险等组级链接档案治理问题。适用于“组级治理”“链接治理”“打开组级治理卡”。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'linkRegistry.maintenanceHub',
    description: '主动呼出链接档案维护入口，优先返回链接维护卡；如果没有逐条维护项，则返回组级治理卡。适用于“链接档案维护”“链接维护卡”“维护链接档案”。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'linkRegistry.resolveProducts',
    description: '按商品名、别名、端内ID、平台商品ID或同款组解析链接档案，返回可供后续工具使用的端内ID列表和数量。短纯数字、端内ID914、ID914 默认按单个端内ID解析；商品ID/平台商品ID/2026... 长ID按平台商品ID精确解析；只有用户明确说同款组/整组/所有该组，或需要按商品名/别名解析整组时，才传 resolutionMode=sameSkuGroup。只做解析，不执行运营动作。',
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
    name: 'publicTraffic.inactiveLinks',
    description: '查询疑似失活、低活跃、长期弱表现、生命周期治理候选链接的端内ID集合。不要用于已下架/已移除/已消失链接，后者应使用 publicTraffic.removedLinks。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'publicTraffic.removedLinks',
    description: '查询最近已下架、已移除、已消失的链接。不要用于疑似失活/低活跃/生命周期治理候选，后者应使用 publicTraffic.inactiveLinks 或 publicTraffic.reportQuery section=lifecycleGovernance。',
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
    name: 'publicTraffic.windowedFindings',
    description: '跨多天公域日报筛选商品发现；当前支持 exposure_without_orders（有曝光但 1 日订单金额为 0）。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: windowedFindingsArgumentsSchema,
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
    requiresConfirmation: false,
    inputSchema: optionalSendToArgumentsSchema,
  },
  {
    name: 'publicTraffic.pushLatestReportToGroup',
    description: '把最新或指定日期的公域流量日报推送到群。指定日期时传 date=YYYY-MM-DD；不重新抓取或生成日报，只发送已有日报上下文。',
    risk: 'write',
    requiresConfirmation: false,
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
    description: '按最新或指定日期公域日报筛选近30天零创单或零订单金额 active 链接，按链接档案汇总待下架链接和补链建议；可传 query 或 sameSkuGroupId 将范围收窄到指定商品/同款组，可传 zeroMetric=amount 表示订单金额为0、zeroMetric=created_orders 表示创单为0；返回只下架 / 下架+补链策略选择卡，确认前不下架、不补链。',
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
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'closedOrder.runObservationReport',
    description: '生成关单观察报告并写入产物',
    risk: 'write',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'rental.daemonStatus',
    description: '只读查询 rental-price-agent daemon 状态，用于确认底层 skill 服务是否可用；不会执行商品写操作。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'rental.platformSearch',
    description: '只读调用 rental-price-agent 在租赁后台按关键词搜索商品，返回候选商品；不会复制、下架或改价。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: rentalPlatformSearchArgumentsSchema,
  },
  {
    name: 'rental.platformSearchAll',
    description: '只读调用 rental-price-agent 遍历租赁后台商品列表，返回受限数量的候选商品；不会复制、下架或改价。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: rentalPlatformSearchAllArgumentsSchema,
  },
  {
    name: 'rental.batchRead',
    description: '只读批量读取多个端内ID的租赁后台当前规格和价格，单次最多 60 个商品；不会执行商品写操作。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: rentalBatchReadArgumentsSchema,
  },
  {
    name: 'rental.batchPreview',
    description: '租赁 batch runner preview 控制面；specFile 必须位于 rental tasks/batches。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalBatchSpecFileArgumentsSchema,
  },
  {
    name: 'rental.batchExecute',
    description: '租赁 batch runner execute 控制面；form-level setup 必须显式 confirmFormSetupWithoutPreview。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalBatchExecuteArgumentsSchema,
  },
  {
    name: 'rental.batchStatus',
    description: '租赁 batch runner status 控制面；stateFile 用于绑定审计上下文。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalBatchStateFileArgumentsSchema,
  },
  {
    name: 'rental.batchResume',
    description: '租赁 batch runner resume 控制面；stateFile 用于绑定审计上下文。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalBatchStateFileArgumentsSchema,
  },
  {
    name: 'rental.batchReport',
    description: '租赁 batch runner report 控制面。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalBatchStateFileArgumentsSchema,
  },
  {
    name: 'rental.batchRollback',
    description: '租赁 batch runner rollback 控制面；confirm=true 时执行回滚。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalBatchRollbackArgumentsSchema,
  },
  {
    name: 'rental.mirrorSearch',
    description: '只读调用 rental mirror search，按关键词返回镜像候选商品；不执行 writeback。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: rentalMirrorKeywordArgumentsSchema,
  },
  {
    name: 'rental.mirrorBatchSpec',
    description: '只读调用 rental mirror batch-spec，生成批处理 spec 草稿；不执行 writeback-state。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: rentalMirrorKeywordArgumentsSchema,
  },
  {
    name: 'rental.specDiscoverFull',
    description: '只读读取租赁商品完整规格维度和规格项；不会新增、删除或刷新规格。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: productIdArgumentsSchema,
  },
  {
    name: 'rental.readRaw',
    description: '只读读取租赁商品原始规格和字段值，可选 fields 限定字段；不会执行商品写操作。',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: rentalReadRawArgumentsSchema,
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
    description: '下架单个或多个租赁商品前的确认请求；多个端内ID请用 productIds 数组。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalDelistArgumentsSchema,
  },
  {
    name: 'rental.delistBatch',
    description: '批量下架多个租赁商品前的确认请求；确认后逐个下架，找不到的商品会跳过并继续。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalDelistBatchArgumentsSchema,
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
    risk: 'read',
    requiresConfirmation: false,
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
    name: 'rental.specAddItem',
    description: '高级表单态：在租赁商品规格维度下添加规格项，确认后执行单个 native spec-add-item 原子动作。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: specAddItemArgumentsSchema,
  },
  {
    name: 'rental.specRefresh',
    description: '高级表单态：刷新租赁商品当前规格结构，确认后执行单个 native spec-refresh 原子动作。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: productIdArgumentsSchema,
  },
  {
    name: 'rental.applyCurrent',
    description: '高级表单态：在当前租赁商品表单页应用变更；必须显式绑定 expectedProductId，确认后发送 native apply-current。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: applyCurrentArgumentsSchema,
  },
  {
    name: 'rental.submitCurrent',
    description: '高级表单态：提交当前租赁商品未保存表单；必须显式绑定 expectedProductId，确认后发送 native submit。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: submitCurrentArgumentsSchema,
  },
  {
    name: 'rental.specRemovePlan',
    description: '按商品名/端内ID/多个端内ID/同款组和规格关键词生成规格项删除预览；只匹配规格项，不删除规格维度；命中明确后展示专用确认卡再执行。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: specRemovePlanArgumentsSchema,
  },
  {
    name: 'rental.priceChange',
    description: '生成租赁商品改价审计预览；明确租期价格如“1天88 10天999”必须转成 fields { rent1day:"88", rent10day:"999" }。倍数/折扣类默认且强制只改租金字段。非租金字段必须用 fields 精准点名。执行前必须展示专用改价确认卡',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPriceChangeArgumentsSchema,
    resultMetadataSchema: rentalPriceChangeResultMetadataSchema,
  },
  {
    name: 'rental.pricePreview',
    description: '按明确端内ID列表生成租赁商品改价审计预览和确认卡；明确租期价格如“1天88 10天999”必须转成 fields { rent1day:"88", rent10day:"999" }。倍数/折扣类默认且强制只改租金字段。非租金字段必须用 fields 精准点名。不负责解析商品名或同款组，确认前不会改价',
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
    description: '生成新链批量复制计划和专用确认卡；可指定 keyword/count/sourceProductId，或用 items 数组分别补链。确认前不会复制商品。If the user gives an explicit internal product id such as 648, ID648, or 端内ID648, pass it as sourceProductId and do not rank/select another same-sku source.',
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
  {
    name: 'rental.perSpecPricePlan',
    description: '按单个商品的具体 specId 生成差异化改价确认卡；只接受已经算好的绝对价格，不做相对计算或场景编排。确认前不会改价。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPerSpecPricePlanArgumentsSchema,
  },
  {
    name: 'rental.perSpecPriceApply',
    description: '确认后按 specId 写入绝对价格字段；每次只调用 daemon nested apply 原子动作。',
    risk: 'high',
    requiresConfirmation: true,
    plannerVisible: false,
    inputSchema: rentalPerSpecPriceApplyArgumentsSchema,
  },
  {
    name: 'rental.specDimPlan',
    description: '生成租赁商品规格维度添加或删除确认卡；add 传 title，remove 传 specDimId。确认前不会修改。',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalSpecDimArgumentsSchema,
  },
  {
    name: 'rental.specDimApply',
    description: '确认后执行单个规格维度添加或删除原子动作。',
    risk: 'high',
    requiresConfirmation: true,
    plannerVisible: false,
    inputSchema: rentalSpecDimArgumentsSchema,
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
