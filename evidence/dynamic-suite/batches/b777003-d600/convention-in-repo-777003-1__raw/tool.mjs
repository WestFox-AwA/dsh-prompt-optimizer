#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
let out = readFileSync(file, 'utf8').trim()
if (args.includes('--help')) { console.log('usage: node tool.mjs [--trim] <file>'); process.exit(0) }
console.log(out)
