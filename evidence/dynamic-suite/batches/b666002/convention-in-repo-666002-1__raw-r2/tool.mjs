#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
if (args.includes('--help')) { console.log('usage: node tool.mjs [--number] [--trim] <file>'); process.exit(0) }
let out = readFileSync(file, 'utf8')
if (args.includes('--number')) {
  out = out.replace(/\n$/, '').split('\n').map((line, i) => `${i + 1}\t${line}`).join('\n')
} else {
  out = out.trim()
}
console.log(out)
