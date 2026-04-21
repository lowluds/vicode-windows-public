export function readStringArgument(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Tool argument "${key}" must be a non-empty string.`);
  }
  return value.trim();
}

export function readOptionalStringArgument(
  args: Record<string, unknown>,
  key: string
) {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readBoundedIntegerArgument(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  maxValue: number
) {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), maxValue));
}
