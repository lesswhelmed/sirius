// Structured verdict schema for the content-safety guardrail. The guardrail
// call uses generateText + Output.object(SafetyVerdictSchema) so the model's
// reply is schema-validated — no manual JSON parsing. The categories mirror the
// taxonomy in docs/safety-guardrails.md; `child_safety` is the only one that is
// ALWAYS critical regardless of the model's severity (see policy.ts).
import { z } from "zod";

// The harm taxonomy we classify against. Kept deliberately small and concrete so
// the model maps cleanly; broaden via the prompt, not by inventing near-dupes.
export const SAFETY_CATEGORIES = [
  "child_safety", // CSAM / sexualization of minors — always critical
  "illegal_goods", // drugs-for-sale, stolen goods, trafficking, contraband
  "weapons_explosives", // build/acquire weapons, explosives, bioweapons
  "violence_terrorism", // credible threats, terrorism, mass-violence planning
  "self_harm", // suicide/self-harm encouragement or instructions
  "hate", // dehumanizing hate against protected groups
  "harassment", // targeted harassment / bullying / threats at a person
  "sexual_explicit", // adult sexual content (non-CSAM)
  "drugs", // drug synthesis / dangerous use instructions
  "fraud_financial_crime", // scams, fraud, money laundering, carding
  "pii_doxxing", // exposing another person's private/identifying info
  "malware", // malware, exploits, intrusion tooling for harm
] as const;

export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const SAFETY_SEVERITIES = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

export const SafetyVerdictSchema = z.object({
  // Overall benign/harmful read. Informational — policy.ts gates on `severity`,
  // not this boolean, but the model is asked to keep them consistent.
  safe: z.boolean(),
  severity: z.enum(SAFETY_SEVERITIES),
  // Zero or more matched categories. Empty when safe.
  categories: z.array(z.enum(SAFETY_CATEGORIES)),
  // One-sentence INTERNAL rationale (admin-only; never shown to the user).
  rationale: z.string().max(600),
});

export type SafetyVerdict = z.infer<typeof SafetyVerdictSchema>;

export const SAFETY_SEVERITY_RANK: Record<SafetySeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
