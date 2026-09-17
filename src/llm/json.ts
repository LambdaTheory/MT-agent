// Some models (Gemini flash tiers in particular) wrap JSON output in a markdown code
// fence despite prompt instructions not to. Previously this was treated as a hard
// failure ("LLM output must be a bare JSON object"), which meant every such response
// fell through to the generic "couldn't parse a plan" reply to the user -- including
// for trivial, everyday commands that don't actually depend on model quality. Stripping
// a full-wrap fence recovers the common case; anything else (partial fence, malformed
// JSON, non-object) still fails loudly below, unchanged.
const FENCE_PATTERN = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

export function parseLlmJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('LLM output is empty');

  const fenceMatch = FENCE_PATTERN.exec(trimmed);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  if (!candidate) throw new Error('LLM output is empty');

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Invalid LLM JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM JSON output must be an object');
  }
  return parsed as Record<string, unknown>;
}
