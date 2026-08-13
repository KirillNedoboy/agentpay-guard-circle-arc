import { createHash } from "node:crypto";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonSafe(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Stable JSON: non-finite number at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertJsonSafe(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Stable JSON: non-JSON-safe value at ${path}.`);
}

function canonicalizeJson(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(",")}}`;
}

export function canonicalize(value: unknown): string {
  assertJsonSafe(value, "value");
  return canonicalizeJson(value);
}

export function stableSha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
