import type { ClosedOrderFeedbackInput, ClosedOrderFeedbackProvider } from './types.js';

export const fakeClosedOrderFeedbackSamples: ClosedOrderFeedbackInput[] = [
  {
    closeId: 'fake-close-001',
    closedAt: '2026-06-18T09:30:00.000Z',
    internalProductId: '701',
    rawRemark: '商家备注：同款价格太低，不接这一单，需要复核价格。',
  },
  {
    closeId: 'fake-close-002',
    closedAt: '2026-06-18T10:15:00.000Z',
    internalProductId: '705',
    rawRemark: '规格不匹配，建议人工确认套餐内容。',
  },
];

export class FakeClosedOrderFeedbackProvider implements ClosedOrderFeedbackProvider {
  readonly calls: ClosedOrderFeedbackInput[] = [];

  constructor(private readonly samples: ClosedOrderFeedbackInput[] = fakeClosedOrderFeedbackSamples) {}

  async getFeedback(input: ClosedOrderFeedbackInput): Promise<ClosedOrderFeedbackInput> {
    this.calls.push(input);
    const sample = this.samples.find((item) => item.internalProductId === input.internalProductId);

    return {
      ...sample,
      ...input,
    };
  }
}

export function createFakeClosedOrderFeedbackProvider(samples?: ClosedOrderFeedbackInput[]): FakeClosedOrderFeedbackProvider {
  return new FakeClosedOrderFeedbackProvider(samples);
}
