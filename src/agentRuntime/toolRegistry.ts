import type { AgentToolDefinition } from './tool.js';

const noArgumentsSchema = { type: 'object', additionalProperties: false };
const keywordArgumentsSchema = { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'], additionalProperties: false };
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
const rentalOperationArgumentsSchema = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    productId: { type: 'string' },
    days: { type: 'string' },
    itemTitle: { type: 'string' },
  },
  required: ['action', 'productId'],
  additionalProperties: false,
};

const agentTools: AgentToolDefinition[] = [
  {
    name: 'publicTraffic.latestSummary',
    description: '查询最新公域日报概况',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: noArgumentsSchema,
  },
  {
    name: 'product.query',
    description: '按商品 ID、平台 ID 或商品名查询表现',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: keywordArgumentsSchema,
  },
  {
    name: 'productId.lookup',
    description: '端内 ID 与平台商品 ID 互查',
    risk: 'read',
    requiresConfirmation: false,
    inputSchema: keywordArgumentsSchema,
  },
  {
    name: 'operationsLearning.startQuiz',
    description: '开始运营学习测验',
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
    name: 'rental.priceChange',
    description: '生成租赁商品改价审计预览；执行前必须展示专用改价确认卡',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: rentalPriceChangeArgumentsSchema,
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
