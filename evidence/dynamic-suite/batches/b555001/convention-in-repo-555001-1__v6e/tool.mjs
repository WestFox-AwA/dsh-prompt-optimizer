#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
let out = readFileSync(file, 'utf8').trim()
// --trim: collapse every run of whitespace into a single space. Whitespace keeps
// this file's existing definition - the JS \s class used by .trim() above
// (space, tab, newline, CR, NBSP, ...) - so newlines collapse too.
if (args.includes('--trim')) out = out.replace(/\s+/g, ' ')
if (args.includes('--help')) { console.log('usage: node tool.mjs [--trim] <file>'); process.exit(0) }
console.log(out)
