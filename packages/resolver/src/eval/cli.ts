#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { ResolverService } from '../service.js';
import { renderMarkdown, runEvaluation } from './harness.js';

const args = process.argv.slice(2);
const gate = args.includes('--gate');
const outDir = resolvePath(process.cwd(), '.eval-out');

const report = runEvaluation(new ResolverService());

mkdirSync(outDir, { recursive: true });
writeFileSync(resolvePath(outDir, 'evaluation.json'), JSON.stringify(report, null, 2), 'utf8');
const markdown = renderMarkdown(report);
writeFileSync(resolvePath(outDir, 'evaluation.md'), markdown, 'utf8');

console.log(markdown);
console.log(`\nWrote ${outDir}/evaluation.json and ${outDir}/evaluation.md`);

if (gate && !report.allGatesPassed) {
  console.error('\nFAILED: one or more evaluation gates did not pass.');
  console.error('Do not weaken a gate to turn this green. Fix the resolver or report the failure.');
  process.exit(1);
}
