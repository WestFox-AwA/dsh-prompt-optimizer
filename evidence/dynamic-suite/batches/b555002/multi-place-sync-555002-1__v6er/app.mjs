import { readFileSync } from 'node:fs'
const cfg = JSON.parse(readFileSync('config.json', 'utf8'))
export const port = cfg.port
if (port !== 7070) { console.error('port mismatch: ' + port); process.exit(1) }
console.log('api listening on ' + port)
