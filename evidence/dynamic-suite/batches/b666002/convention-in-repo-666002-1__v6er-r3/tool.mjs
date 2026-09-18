#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
let out = readFileSync(file, 'utf8').trim()
if (args.includes('--help')) { console.log('usage: node tool.mjs [--trim] [--number] <file>'); process.exit(0) }
if (args.includes('--number')) out = out.split('\n').map((line, i) => `${i + 1}\t${line}`).join('\n')
console.log(out)
