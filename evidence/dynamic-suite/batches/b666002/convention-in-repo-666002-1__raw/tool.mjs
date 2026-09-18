#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
let out = readFileSync(file, 'utf8').trim()
if (args.includes('--help')) { console.log('usage: node tool.mjs [--trim] [--number] <file>'); process.exit(0) }
const lines = out.split('\n').filter((line) => line.trim() !== '')
const width = String(lines.length).length
lines.forEach((line, i) => {
  if (args.includes('--number')) console.log(`${String(i + 1).padStart(width)}\t${line}`)
  else console.log(line)
})
