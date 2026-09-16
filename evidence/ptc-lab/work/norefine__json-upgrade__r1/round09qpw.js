import fs from 'node:fs';
const p = 'config.json';
fs.writeFileSync(p, '{"name":"demo","retries":3}\n');
const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
const upgraded = { name: obj.name, retries: obj.retries, enabled: true, version: 2 };
fs.writeFileSync(p, JSON.stringify(upgraded) + '\n');
const finalRaw = fs.readFileSync(p, 'utf8');
const check = JSON.parse(finalRaw);
const ok = check.name === 'demo' && check.retries === 3 && check.enabled === true && check.version === 2
  && JSON.stringify(Object.keys(check)) === JSON.stringify(['name','retries','enabled','version']);
console.log('--- config.json ---');
console.log(finalRaw);
if (ok) console.log('DONE: config.json upgraded to v2 with keys order preserved');
else { console.error('VERIFY FAILED', check); process.exit(1); }
