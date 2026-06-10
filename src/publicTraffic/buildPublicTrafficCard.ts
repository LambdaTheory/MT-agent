import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { PublicTrafficDataReportContext, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topText(title: string, items: PublicTrafficReportSectionItem[]): string {
  const lines = items.length > 0 ? items.slice(0, 5).map((item, index) => `${index + 1}. ${item.identifier}｜${item.reason}`) : ['无'];
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
        { tag: 'markdown', content: `**今日漏斗**\n曝光：${one.exposure}\n公域访问：${one.publicVisits}\n后链路访问：${one.dashboardVisits}\n订单：${one.createdOrders}\n发货：${one.shippedOrders}\n金额：¥${one.amount.toFixed(2)}\n曝光到访问率：${percent(one.exposureVisitRate)}\n访问到发货率：${percent(one.visitShipmentRate)}` },
        { tag: 'hr' },
        { tag: 'markdown', content: `**模块数量**\n曝光不足：${context.lowExposure.length}个\n曝光有但点击弱：${context.weakClick.length}个\n点击有但转化弱：${context.weakConversion.length}个\n高潜力商品：${context.highPotential.length}个` },
        { tag: 'hr' },
        { tag: 'markdown', content: topText('曝光不足 Top5', context.lowExposure) },
        { tag: 'markdown', content: topText('点击弱 Top5', context.weakClick) },
        { tag: 'markdown', content: topText('转化弱 Top5', context.weakConversion) },
        { tag: 'markdown', content: `**报告文件**\nMarkdown：${paths.markdownPath}\nXLSX：${paths.workbookPath}` },
      ],
    },
  };
}
