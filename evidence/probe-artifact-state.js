// 交付物自检表达式：把页面自己的错误通道全掏出来（覆盖层详情 + 全局 SHADER_ERRORS + 画布尺寸）
(() => {
  const t = (id) => { const el = document.getElementById(id); return el ? String(el.textContent || '').slice(0, 300) : null };
  const cv = document.querySelector('canvas');
  let glInfo = null;
  try {
    const probe = document.createElement('canvas');
    const g = probe.getContext('webgl2');
    glInfo = g ? { ok: true, renderer: g.getParameter(g.RENDERER), version: g.getParameter(g.VERSION) } : { ok: false };
  } catch (e) { glInfo = { ok: false, err: String(e && e.message) } }
  return {
    title: t('fatalTitle'), msg: t('fatalMsg'), detail: t('fatalDetail'),
    boot: t('bootMsg'),
    shaderErrors: (window.SHADER_ERRORS || []).slice(0, 2),
    canvas: cv ? { w: cv.width, h: cv.height, cw: cv.clientWidth, ch: cv.clientHeight, id: cv.id } : null,
    glProbe: glInfo,
    bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
  };
})()
