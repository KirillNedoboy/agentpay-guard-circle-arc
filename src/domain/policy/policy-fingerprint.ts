import { canonicalize, stableSha256 } from "@/lib/stable-json";

export function canonicalizePolicy(policy: unknown): string {
  return canonicalize(policy);
}

export function fingerprintPolicy(policy: unknown): string {
  return `sha256:${stableSha256(policy)}`;
}
