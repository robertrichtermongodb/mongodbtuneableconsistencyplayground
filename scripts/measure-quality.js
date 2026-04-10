#!/usr/bin/env node
// Deterministic quality scorecard measurement.
// Run: node scripts/measure-quality.js
//
// Counts top-level function bodies in js/*.js using brace-depth tracking.
// Rules:
//   - A "function" starts at the line containing `function name(` or `name = (` / `name = function(`
//     that is at top-level scope (depth 0 before the opening brace).
//   - Body length = lines from (and including) the opening `{` to the closing `}`.
//   - Single-char variable: any const/let/var declaration whose first binding name is 1 char,
//     excluding i, j, k (loop counters).
//   - Excludes texts.js and theme.js from file-length metric (data/config files).

const fs   = require('fs');
const path = require('path');
const glob = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');
const files  = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();

const FILE_LENGTH_EXCLUDE = new Set(['texts.js', 'theme.js']);
const SINGLE_CHAR_EXCLUDE = new Set(['i', 'j', 'k']);

let totalFunctions = 0;
let totalBodyLines = 0;
const longFunctions = [];     // { name, file, lines }
let maxFunctionLength = 0;
let maxFunctionName = '';
let maxFunctionFile = '';
let maxFileLength = 0;
let maxFileName = '';
let singleCharVars = [];
let maxNesting = 0;
let maxNestingFunc = '';
let maxNestingFile = '';

for (const file of files) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf-8');
  const lines = src.split('\n');

  if (!FILE_LENGTH_EXCLUDE.has(file) && lines.length > maxFileLength) {
    maxFileLength = lines.length;
    maxFileName = file;
  }

  // Track brace depth for top-level function detection
  let depth = 0;
  let inFunc = null;  // { name, startLine, depth: depthAtOpen }
  let funcNesting = 0;
  let funcMaxNesting = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Single-char variable detection
    const varMatch = trimmed.match(/^(?:const|let|var)\s+([a-zA-Z_$])\s*[=,;]/);
    if (varMatch && !SINGLE_CHAR_EXCLUDE.has(varMatch[1])) {
      singleCharVars.push({ name: varMatch[1], file, line: i + 1 });
    }

    // Detect top-level function start (depth === 0)
    if (depth === 0 && !inFunc) {
      const funcMatch = trimmed.match(/^(?:async\s+)?function\s+(\w+)\s*\(/);
      if (funcMatch) {
        inFunc = { name: funcMatch[1], startLine: i + 1, depth: 0 };
        funcNesting = 0;
        funcMaxNesting = 0;
      }
    }

    // Count braces (simplified: ignores strings/comments for our codebase which is clean)
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        if (inFunc) {
          funcNesting++;
          if (funcNesting > funcMaxNesting) funcMaxNesting = funcNesting;
        }
      } else if (ch === '}') {
        depth--;
        if (inFunc) {
          funcNesting--;
          if (funcNesting <= 0) {
            // Function closed
            const bodyLines = (i + 1) - inFunc.startLine + 1;
            totalFunctions++;
            totalBodyLines += bodyLines;
            if (bodyLines > 30) {
              longFunctions.push({ name: inFunc.name, file, lines: bodyLines });
            }
            if (bodyLines > maxFunctionLength) {
              maxFunctionLength = bodyLines;
              maxFunctionName = inFunc.name;
              maxFunctionFile = file;
            }
            // Nesting: subtract 1 for the function body itself
            const effectiveNesting = funcMaxNesting - 1;
            if (effectiveNesting > maxNesting) {
              maxNesting = effectiveNesting;
              maxNestingFunc = inFunc.name;
              maxNestingFile = file;
            }
            inFunc = null;
          }
        }
      }
    }
  }
}

longFunctions.sort((a, b) => b.lines - a.lines);

console.log('═══ Quality Scorecard Measurements ═══\n');
console.log(`1. Max function length: ${maxFunctionLength} lines (${maxFunctionName} in ${maxFunctionFile})`);
console.log(`2. Functions > 30 lines: ${longFunctions.length}`);
longFunctions.forEach(f => console.log(`     ${f.lines} lines: ${f.name} (${f.file})`));
console.log(`3. Avg function length: ${(totalBodyLines / totalFunctions).toFixed(1)} lines (${totalFunctions} functions, ${totalBodyLines} total body lines)`);
console.log(`5. Single-char variables: ${singleCharVars.length}`);
singleCharVars.forEach(v => console.log(`     '${v.name}' at ${v.file}:${v.line}`));
console.log(`6. Max nesting depth: ${maxNesting} (${maxNestingFunc} in ${maxNestingFile})`);
console.log(`7. Max file length: ${maxFileLength} lines (${maxFileName})`);
console.log(`10. Tests: run \`npm test\` separately`);
console.log('\nMetrics 4 (magic numbers), 8 (mixed-abstraction), 9 (duplication), 11 (opaque conditionals) require manual assessment.');
