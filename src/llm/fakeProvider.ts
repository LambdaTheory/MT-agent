import { parseLlmJsonObject } from './json.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from './provider.js';

export class FakeLlmProvider implements LlmProvider {
  lastInput?: LlmGenerateJsonInput;

  constructor(private readonly responseText: string) {}

  async generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    this.lastInput = input;
    return {
      text: this.responseText,
      json: parseLlmJsonObject(this.responseText),
      model: 'fake',
    };
  }
}
