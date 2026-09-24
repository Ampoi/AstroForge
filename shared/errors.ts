export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("JSON object required");
  return value as Record<string, unknown>;
}
