import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import { getNewProductPool, getProblemProducts } from './publicTrafficQueries.js';
import type { AgentProblemType, AgentTaskItem } from './types.js';

const priorityByType: Record<AgentProblemType, number> = { high_potential: 90, weak_conversion: 80, low_exposure: 70, new_product_pool: 60, recommended_action: 50 };

export function buildAgentTaskPool(context: PublicTrafficDataReportContext): AgentTaskItem[] {
  const tasks: AgentTaskItem[] = [];
  for (const type of ['high_potential', 'weak_conversion', 'low_exposure', 'recommended_action'] as AgentProblemType[]) {
    for (const item of getProblemProducts(context, type)) {
      tasks.push({ productId: item.productId, productName: '', taskType: type, priority: priorityByType[type], reason: item.reason, suggestedAction: item.action, status: '待处理' });
    }
  }
  for (const item of getNewProductPool(context)) {
    tasks.push({ productId: item.productId, productName: item.productName, taskType: 'new_product_pool', priority: priorityByType.new_product_pool, reason: item.productName || '新品池待维护', suggestedAction: item.maintenanceStatus, status: '待处理' });
  }
  const uniqueTasks = new Map<string, AgentTaskItem>();
  for (const task of tasks) {
    const key = `${task.productId}\0${task.suggestedAction}`;
    const existing = uniqueTasks.get(key);
    if (!existing || task.priority > existing.priority) {
      uniqueTasks.set(key, task);
    }
  }
  return [...uniqueTasks.values()].sort((a, b) => b.priority - a.priority || a.productId.localeCompare(b.productId));
}
