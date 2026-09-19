// 探针表达式：判断"引擎在画但画面全黑"到底是哪一段黑的（只读页面状态，不改页面）
// 用 render-probe.cjs --eval "$(cat evidence/probe-black-expr.js)" 调用
(() => {
  const out = {};
  const canvas = document.querySelector('canvas');
  out.canvas = canvas ? { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight } : null;
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  if (gl) {
    out.gl = {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      clearColor: Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) || []),
      viewport: Array.from(gl.getParameter(gl.VIEWPORT) || []),
      float: !!gl.getExtension('EXT_color_buffer_float'),
      aniso: !!gl.getExtension('EXT_texture_filter_anisotropic'),
    };
    // 画布本身读一次像素（同一帧内有效）：全黑 → 合成/后处理段黑的；非黑 → 画面其实画出来了
    try {
      const w = Math.min(64, canvas.width), h = Math.min(64, canvas.height);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(Math.floor(canvas.width / 2 - w / 2), Math.floor(canvas.height / 2 - h / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, max = 0;
      for (let i = 0; i < px.length; i += 4) { const v = px[i] + px[i + 1] + px[i + 2]; sum += v; if (v > max) max = v; }
      out.canvasPixels = { mean: +(sum / (px.length / 4) / 3).toFixed(2), max: max, note: '全 0 = 画布中心区域是纯黑' };
    } catch (e) { out.canvasPixels = 'readPixels 失败: ' + e.message }
  }
  // 应用自己的全局对象（不同引擎命名不同，这里只做浅层列举，不深拷贝）
  const names = Object.keys(window).filter((k) => /^(APP|GL|RT|CAM|SCENE|STATE|CFG|OPT|SUN|LIGHT|WORLD|ENGINE|RENDER|SIM|VIEW|MAIN)/.test(k));
  out.globals = names.slice(0, 25);
  const pick = (obj, keys) => {
    const o = {};
    if (!obj || typeof obj !== 'object') return o;
    for (const k of keys) {
      const v = obj[k];
      if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) o[k] = v;
      else if (Array.isArray(v) && v.length < 8 && v.every((x) => typeof x === 'number')) o[k] = v;
      else if (v && typeof v === 'object' && typeof v.x === 'number') o[k] = [v.x, v.y, v.z].filter((n) => n !== undefined);
    }
    return o;
  };
  for (const n of names.slice(0, 8)) {
    const v = window[n];
    if (v && typeof v === 'object') out['peek_' + n] = pick(v, ['w', 'h', 'width', 'height', 'pos', 'position', 'target', 'eye', 'near', 'far', 'fov', 'aspect', 'intensity', 'quality', 'tier', 'exposure', 'time']);
  }
  return out;
})()
