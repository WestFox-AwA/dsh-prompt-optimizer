// 多帧 zstd 会话日志解码器（Node 的 zstdDecompressSync 只吃第一帧，这里按 magic 切帧逐帧解）
// 用法：require('./zstd-frames.cjs').decodeAll(filePath) -> string（全部帧拼起来的 jsonl 文本）
const fs = require('node:fs');
const zlib = require('node:zlib');

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function frameOffsets(buf) {
  const offs = [];
  let i = 0;
  while (i >= 0 && i < buf.length) {
    const at = buf.indexOf(MAGIC, i);
    if (at < 0) break;
    offs.push(at);
    i = at + 4;
  }
  return offs;
}

/** 解出所有帧的文本；坏帧跳过并计入 bad（4 字节 magic 在压缩数据里撞车的概率≈0，所以 bad 正常为 0） */
function decodeAll(file, opts = {}) {
  const buf = fs.readFileSync(file);
  const offs = frameOffsets(buf);
  const parts = [];
  let bad = 0;
  const limit = opts.limit || 0;
  for (const off of offs) {
    if (limit && parts.length >= limit) break;
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(off)).toString('utf8'));
    } catch { bad++ }
  }
  return { text: parts.join(''), frames: offs.length, ok: parts.length, bad };
}

module.exports = { decodeAll, frameOffsets };

if (require.main === module) {
  const t0 = Date.now();
  const r = decodeAll(process.argv[2]);
  console.log(`frames=${r.frames} ok=${r.ok} bad=${r.bad} chars=${r.text.length} 用时=${Date.now() - t0}ms`);
}
