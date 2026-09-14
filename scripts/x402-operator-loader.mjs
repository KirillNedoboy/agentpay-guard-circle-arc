/**
 * x402-operator-loader.mjs — minimal ESM resolve hook for the I5 operator
 * live path ONLY (registered by `scripts/x402-gateway-testnet.mjs` after the
 * operator gate has authorized live mode; or via
 * `node --import ./scripts/x402-operator-loader.mjs`).
 *
 * Purpose (boring on purpose — no compilation, no caching, no transforms):
 *   1. Map the repo's `@/…` TypeScript path alias to `<repoRoot>/src/…` and
 *      resolve extensionless specifiers against a `.ts` file (Node's native
 *      type stripping then executes the `.ts` sources).
 *   2. Retry extensionless RELATIVE specifiers with a `.ts` extension
 *      (TypeScript source files import each other without extensions).
 *   3. Delegate EVERYTHING else untouched to `nextResolve`.
 *
 * It performs no network access, reads no key material, and applies no
 * security logic. It is never registered on the refusal path.
 */
import { existsSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// <repoRoot>/src — the loader lives in <repoRoot>/scripts.
const SRC_URL = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = new URL(specifier.slice(2), SRC_URL);
    if (existsSync(fileURLToPath(target))) {
      return nextResolve(target.href, context);
    }
    const withTs = new URL(`${target.href}.ts`);
    if (existsSync(fileURLToPath(withTs))) {
      return nextResolve(withTs.href, context);
    }
    return nextResolve(specifier, context);
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-zA-Z]+$/.test(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
      throw error;
    }
  }

  return nextResolve(specifier, context);
}
