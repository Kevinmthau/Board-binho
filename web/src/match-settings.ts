export const GAME_NAME = "Flick Soccer";
export const MODE_NAME = "COMPETITIVE";
export const GOAL_TARGETS = [1, 3, 5, 7] as const;
export const STANDARD_TARGET = 3;

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(
      localStorage.getItem("flick-soccer:" + key) ?? "null",
    );
    if (Array.isArray(fallback))
      return Array.isArray(value) ? (value as T) : fallback;
    if (typeof fallback === "number")
      return typeof value === "number" && Number.isFinite(value)
        ? (value as T)
        : fallback;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem("flick-soccer:" + key, JSON.stringify(value));
  } catch {
    /* Private browser preview. */
  }
}
