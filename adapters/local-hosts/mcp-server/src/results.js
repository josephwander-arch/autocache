const MAX_OUTPUT_CHARS = 12_000;

export function cleanText(value, max = 1000) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}
export function cleanList(values, maxItems = 25, maxChars = 1000) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, maxItems)
    .map((value) => cleanText(value, maxChars))
    .filter(Boolean);
}

function boundedJson(value) {
  let json;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    json = JSON.stringify({ ok: false, error: 'result could not be serialized' }, null, 2);
  }
  if (json.length <= MAX_OUTPUT_CHARS) return json;
  return JSON.stringify({
    ok: true,
    truncated: true,
    original_chars: json.length,
    preview: json.slice(0, MAX_OUTPUT_CHARS - 300)
  }, null, 2);
}

export function okResult(value) {
  return {
    content: [{ type: 'text', text: boundedJson(value) }]
  };
}

export function errorResult(error) {
  const message = cleanText(error instanceof Error ? error.message : error, 1000)
    || 'AutoCache operation failed';
  return {
    isError: true,
    content: [{
      type: 'text',
      text: boundedJson({ ok: false, error: message })
    }]
  };
}

export function guarded(handler) {
  return async (input) => {
    try {
      return okResult(await handler(input || {}));
    } catch (error) {
      return errorResult(error);
    }
  };
}
