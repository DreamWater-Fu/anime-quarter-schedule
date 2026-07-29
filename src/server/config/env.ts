import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LoadLocalEnvOptions {
  cwd?: string;
  files?: string[];
  env?: NodeJS.ProcessEnv;
  override?: boolean;
}

const DEFAULT_ENV_FILES = [".env.local", ".env"];
let defaultEnvLoaded = false;

export function loadLocalEnv(options: LoadLocalEnvOptions = {}): void {
  const isDefaultLoad =
    options.cwd === undefined &&
    options.files === undefined &&
    options.env === undefined &&
    options.override === undefined;

  if (isDefaultLoad && defaultEnvLoaded) return;

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const files = options.files ?? DEFAULT_ENV_FILES;
  const override = options.override ?? false;

  for (const file of files) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;

    const values = parseEnvFile(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (override || env[key] === undefined) env[key] = value;
    }
  }

  if (isDefaultLoad) defaultEnvLoaded = true;
}

export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!assignment) continue;

    const [, key, rawValue] = assignment;
    result[key] = normalizeEnvValue(rawValue ?? "");
  }

  return result;
}

function normalizeEnvValue(value: string): string {
  const rawTrimmed = value.trim();
  if (rawTrimmed.startsWith("#")) return "";

  const trimmed = stripInlineComment(rawTrimmed);
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === "\"" ? unescapeDoubleQuotedValue(unquoted) : unquoted;
  }

  return trimmed;
}

function stripInlineComment(value: string): string {
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && (index === 0 || value[index - 1] !== "\\")) {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === "#" && quote === null && /\s/.test(value[index - 1] ?? "")) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function unescapeDoubleQuotedValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}
