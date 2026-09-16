// 取活实例权威版本：node evidence/probe-version.cjs
const http = require('http')
const get = (path) => new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 3080, path, timeout: 8000 }, (r) => {
    let b = ''
    r.setEncoding('utf8')
    r.on('data', (d) => { b += d })
    r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { res({ _raw: b.slice(0, 400) }) } })
  })
  req.on('error', (e) => res({ _err: String(e.message) }))
  req.on('timeout', () => { req.destroy(); res({ _err: 'timeout' }) })
})
;(async () => {
  const state = await get('/prompt-optimizer/api/state')
  console.log('state keys: ' + JSON.stringify(Object.keys(state || {})))
  if (state && state.state) console.log('state.state keys: ' + JSON.stringify(Object.keys(state.state || {})) + ' version=' + JSON.stringify(state.state.version))
  if (state && state.settings) console.log('settings: ' + JSON.stringify(state.settings).slice(0, 300))
  const runs = await get('/prompt-optimizer/api/runs')
  const list = (runs && runs.runs) || []
  console.log('runs=' + list.length)
  for (const r of list.slice(-6)) console.log('  id=' + r.id + ' version=' + JSON.stringify(r.version) + ' status=' + r.status + ' chars=' + r.chars + ' tier=' + JSON.stringify(r.tier) + ' provider=' + JSON.stringify(r.provider))
})()
