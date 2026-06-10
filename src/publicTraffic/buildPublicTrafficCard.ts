import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { PublicTrafficDataReportContext, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topText(title: string, items: PublicTrafficReportSectionItem[], emptyNote: string, limit = 5): string {
  const lines = items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.action}｜${item.reason}`) : [emptyNote];
  return `**${title}**\n${lines.join('\n')}`;
}

export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, paths: PublicTrafficReportPaths): FeishuCardPayload {
  const one = context.summary['1d'];
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `公域数据日报 ${context.date}` },
      template: 'blue',
    },
    body: {
      elements: [
        { tag: 'markdown', content: `**经营结论**\n${context.conclusions.map((item) => `${item.label}：${item.text}`).join('\n')}` },
        { tag: 'hr' },
        { tag: 'markdown', content: `**今日漏斗**\n曝光：${one.exposure}\n公域访问：${one.publicVisits}\n后链路访问：${one.dashboardVisits}\n订单：${one.createdOrders}\n发货：${one.shippedOrders}\n金额：¥${one.amount.toFixed(2)}\n曝光到访问率：${percent(one.exposureVisitRate)}\n访问到发货率：${percent(one.visitShipmentRate)}` },
        { tag: 'hr' },
        { tag: 'markdown', content: `**模块数量**\n曝光不足：${context.lowExposure.length}个\n曝光有但点击弱：${context.weakClick.length}个\n点击有但转化弱：${context.weakConversion.length}个\n高潜力商品：${context.highPotential.length}个` },
        { tag: 'hr' },
        { tag: 'markdown', content: topText('建议操作', context.recommendedActions, context.emptySectionNotes.recommendedActions, 8) },
        { tag: 'hr' },
        { tag: 'markdown', content: topText('曝光不足 Top5', context.lowExposure, context.emptySectionNotes.lowExposure) },
        { tag: 'markdown', content: topText('点击弱 Top5', context.weakClick, context.emptySectionNotes.weakClick) },
        { tag: 'markdown', content: topText('转化弱 Top5', context.weakConversion, context.emptySectionNotes.weakConversion) },
        { tag: 'markdown', content: topText('高潜力 Top5', context.highPotential, context.emptySectionNotes.highPotential) },
        { tag: 'markdown', content: topText('新品观察 Top5', context.newProductObservation, context.emptySectionNotes.newProductObservation) },
        { tag: 'markdown', content: topText('生命周期治理 Top5', context.lifecycleGovernance, context.emptySectionNotes.lifecycleGovernance) },
        { tag: 'markdown', content: `**报告文件**\nMarkdown：${paths.markdownPath}\nXLSX：${paths.workbookPath}` },
      ],
    },
  };
}
