/**
 * Type declarations for dsh-auto-approval.
 * The runtime is plain JavaScript; these types describe the Cordis plugin
 * surface and the pure decision module for consumers and editors.
 */

export interface AutoApprovalConfig {
  /** Master switch for the automated answerer. Default: true. */
  enabled?: boolean;
  /** Only auto-approve sessions whose effective preset is `auto-approval`. Default: true. */
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
  /** Non-loopback authorities allowed to reach the configuration HTTP API. Default: []. */
  trustedHosts?: string[];
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

export const PRESET_NAME: "auto-approval";
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
export function resolveRealPath(path: string): string;

/** The settings namespace key for this plugin's user-editable section. */
export const NS: string;
export const schema: unknown;
export function defaultsOf(config: AutoApprovalConfig): Record<string, unknown>;
export function assertValidEffectiveConfig(value: Record<string, unknown>): Record<string, unknown>;

export const CONFIG_PATH: string;
export const STATUS_PATH: string;
export function isTrustedRequest(req: unknown, trustedHosts?: string[]): boolean;
export function createHandlers(options: {
  trustedHosts?: string[];
  readConfig: () => unknown;
  writeConfig: (body: Record<string, unknown>) => Promise<unknown>;
  readStatus: () => unknown;
  onError?: (error: unknown) => void;
}): { api: unknown };
