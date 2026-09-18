#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const file = args.find((a) => !a.startsWith('--')) || 'input.txt'
if (flags.has('--help')) { console.log('usage: tool.mjs --dry-run --json --quiet --force <file>'); process.exit(0) }
const text = readFileSync(file, 'utf8')
if (flags.has('--json')) { console.log(JSON.stringify({ file, lines: text.split('\n').length })); process.exit(0) }
if (!flags.has('--quiet')) console.log(text.trim())
if (flags.has('--dry-run')) console.log('(dry run)')
