import type { AgentToolDefinition } from './tool.js';

const noArgumentsSchema = { type: 'object', additionalProperties: false };
const keywordArgumentsSchema = { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'], additionalProperties: false };
const productIdArgumentsSchema = { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'], additionalProperties: false };
const goodsExportPathArgumentsSchema = { type: 'object', properties: { goodsExportPath: { type: 'string' } }, required: ['goodsExportPath'], additionalProperties: false };
const optionalSendToArgumentsSchema = {
  type: 'object',
  properties: { sendTo: { type: 'string' } },
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
    name: 'publicTraffic.crawlSources',
    description: '抓取公域日报所需的商品总表、曝光、后链路与订单分析原始数据',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema: goodsExportPathArgumentsSchema,
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
    name: 'rental.pricePreview',
    description: '预览租赁商品改价，不直接执行改价',
    risk: 'high',
    requiresConfirmation: true,
    inputSchema: productIdArgumentsSchema,
  },
  {
    name: 'rental.operationConfirmRequest',
    description: '执行租赁商品复制、下架、租期设置、规格查看或规格添加前的确认请求',
    risk: 'high',
    requiresConfirmation: true,
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
