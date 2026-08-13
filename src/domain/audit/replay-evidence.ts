import type { AuditRecord } from "./types";
import type { PolicyConfig } from "@/domain/policy/policy-config";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";

export type ReplayEvidence = {
  replayed: boolean;
  replayMismatch: boolean | null;
  policyChanged: boolean | null;
  storedIntentFingerprint: string | null;
  currentIntentFingerprint: string;
  storedPolicyVersion: string | null;
  currentPolicyVersion: string;
  storedPolicyFingerprint: string | null;
  currentPolicyFingerprint: string;
};

export function buildReplayEvidence(
  audit: AuditRecord,
  currentIntentFingerprint: string,
  currentPolicy: PolicyConfig,
  replayed: boolean
): ReplayEvidence {
  const storedIntentFingerprint = audit.intentFingerprint ?? null;
  const storedPolicyVersion = audit.policyVersion ?? null;
  const storedPolicyFingerprint = audit.policyFingerprint ?? null;
  const currentPolicyVersion = currentPolicy.policyVersion;
  const currentPolicyFingerprint = fingerprintPolicy(currentPolicy);

  const replayMismatch =
    storedIntentFingerprint === null ? null : storedIntentFingerprint !== currentIntentFingerprint;
  const policyChanged =
    storedPolicyVersion === null || storedPolicyFingerprint === null
      ? null
      : storedPolicyVersion !== currentPolicyVersion || storedPolicyFingerprint !== currentPolicyFingerprint;

  return {
    replayed,
    replayMismatch,
    policyChanged,
    storedIntentFingerprint,
    currentIntentFingerprint,
    storedPolicyVersion,
    currentPolicyVersion,
    storedPolicyFingerprint,
    currentPolicyFingerprint
  };
}
