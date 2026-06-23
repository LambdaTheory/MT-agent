export type RecordedActivityStep =
  | { type: 'click'; label: string; selectorHint?: string }
  | { type: 'fill'; label: string; valueKey: string; selectorHint?: string }
  | { type: 'select'; label: string; valueKey: string; selectorHint?: string }
  | { type: 'waitFor'; text?: string; selector?: string };

export interface ActivityRecordingDraft {
  businessPurpose: 'differential-pricing';
  url: string;
  capturedAt: string;
  steps: RecordedActivityStep[];
  notes: string[];
}

export function createEmptyActivityRecordingDraft(url: string, capturedAt = new Date().toISOString()): ActivityRecordingDraft {
  return { businessPurpose: 'differential-pricing', url, capturedAt, steps: [], notes: ['差异化定价流程录制草稿；当前模块只侦察页面，不提交配置。'] };
}
