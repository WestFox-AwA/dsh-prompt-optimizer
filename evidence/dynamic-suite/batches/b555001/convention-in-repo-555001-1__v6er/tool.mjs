#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
const trim = args.includes('--trim')
let out = readFileSync(file, 'utf8')
if (trim) out = out.replace(/\s+/g, ' ').trim()
if (args.includes('--help')) { console.log('usage: node tool.mjs [--trim] <file>'); process.exit(0) }
console.log(out)
