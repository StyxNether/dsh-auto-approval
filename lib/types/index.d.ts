/**
 * Type declarations for dsh-auto-approval.
 * The runtime is plain JavaScript; these types describe the Cordis plugin
 * surface and the pure decision module for consumers and editors.
 */

export interface AutoApprovalConfig {
  /** Master switch for the automated answerer. Default: true. */
  enabled?: boolean;
  /** Only auto-approve sessions whose effective preset is `trusted-auto`. Default: true. */
  requireTrustedPreset?: boolean;
  /** Absolute paths whose commands and file targets are auto-approved. Default: []. */
  trustedAreas?: string[];
  /** Regex sources matched (case-insensitive) against command text. Default: curated introspection set. */
  harmlessPatterns?: string[];
  /** Regex sources that short-circuit to delegation. Default: system-root destructive operations. */
  dangerousPatterns?: string[];
  /** Commands/targets longer than this defer. Default: 4000. */
  maxCommandChars?: number;
  /** Log each auto-approval decision. Default: true. */
  logDecisions?: boolean;
}

export type Decision = "allow" | "defer";

export interface ClassifyResult {
  decision: Decision;
  rule: string;
}

export interface ClassifyInput {
  toolName: string;
  args: Record<string, unknown>;
  baseDir?: string;
  trustedRoots: string[];
  harmlessPatterns: RegExp[];
  dangerousPatterns: RegExp[];
  maxCommandChars: number;
  caseSensitive?: boolean;
}

export const PRESET_NAME: "trusted-auto";
export const name: "dsh-auto-approval";
export const inject: readonly [];
export const Config: unknown;

export function apply(ctx: unknown, config: AutoApprovalConfig): void;

export function classifyRequest(input: ClassifyInput): ClassifyResult;
export function compilePatterns(patterns: string[]): RegExp[];
export function isUnderRoot(candidate: string, root: string, caseSensitive?: boolean): boolean;
export function containsPathReference(text: string, root: string, caseSensitive?: boolean): boolean;
export function findToolCall(
  events: ReadonlyArray<{ type: string; data?: { callId?: unknown; name?: unknown } }>,
  callId: unknown,
  toolName?: string
): unknown;
export function parseArguments(raw: unknown): Record<string, unknown> | null;
