export function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function settingValue(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

export function megabytesToBytesOrNull(value: string): number | null {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 1024 * 1024);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseDraggedImageIds(rawIds: string, fallback: string[]): string[] {
  if (!rawIds) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawIds);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return parsed;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
