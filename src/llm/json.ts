export function parseLlmJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('LLM output is empty');
  if (/^```/.test(trimmed) || /```$/.test(trimmed)) throw new Error('LLM output must be a bare JSON object');

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Invalid LLM JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM JSON output must be an object');
  }
  return parsed as Record<string, unknown>;
}
