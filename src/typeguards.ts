export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

export function pickString(
  obj: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const v = obj[key];
  return isString(v) ? v : fallback;
}

export function pickOptionalString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return isString(v) && v !== "" ? v : undefined;
}
