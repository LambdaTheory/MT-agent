import { parseLlmJsonObject } from './json.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from './provider.js';

export class FakeLlmProvider implements LlmProvider {
  lastInput?: LlmGenerateJsonInput;
  private index = 0;

  constructor(private readonly responseText: string | string[]) {}

  async generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    this.lastInput = input;
    const text = Array.isArray(this.responseText)
      ? this.responseText[Math.min(this.index++, this.responseText.length - 1)]
      : this.responseText;
    return {
      text,
      json: parseLlmJsonObject(text),
      model: 'fake',
    };
  }
}
