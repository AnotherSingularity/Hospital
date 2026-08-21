#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/**
 * Minimal secret and PHI-shape scanner for CI. It is a tripwire, not a
 * guarantee: it catches the obvious accident of a real key or a real-looking
 * identifier reaching the repository.
 */

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.eval-out',
  'playwright-report',
  'test-results',
]);
const SCAN_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.yml',
  '.yaml',
  '.md',
  '.css',
  '.html',
]);

interface Finding {
  file: string;
  line: number;
  rule: string;
}

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'generic-assigned-secret',
    pattern:
      /\b(?:api[_-]?key|secret|passwd|password|private[_-]?token)\s*[:=]\s*['"][A-Za-z0-9/+=_-]{16,}['"]/i,
  },
  { name: 'us-ssn-shape', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    name: 'connection-string-with-password',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb)(?:\+srv)?:\/\/[^\s:@/]+:[^\s:@/]+@/,
  },
];

// Values that are intentionally present and are not secrets.
const ALLOWLIST = ['dev-token-not-a-secret', 'cadence_local_dev_only', 'CADENCE_DEV_TOKEN'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(extname(entry))) out.push(full);
  }
  return out;
}

const findings: Finding[] = [];
const files = walk(ROOT);

for (const file of files) {
  if (relative(ROOT, file) === join('scripts', 'secret-scan.ts')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (ALLOWLIST.some((a) => line.includes(a))) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file: relative(ROOT, file), line: index + 1, rule: rule.name });
      }
    }
  });
}

console.log(`secret-scan: examined ${files.length} files`);
if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} potential secret(s) found.`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  process.exit(1);
}
console.log('secret-scan: no findings');
