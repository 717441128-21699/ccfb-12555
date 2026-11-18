// view2d.js — 任意轴向位置 z 的横截面剖视(2D 画布)
// 圆线:每根单丝画圆;紧压:每根单丝画扇形(随 z 绕轴旋转)
const LAYER_COLORS = ['#c47b3a', '#8a9ba8', '#d8a24a', '#6f8f6a', '#b0653f', '#7a86b0', '#c98f5a', '#5f7f8f'];

export function createView2D(canvas) {
  const ctx = canvas.getContext('2d');

  /**
   * result: computeStranding 返回值; z: 剖面轴向位置 (mm)
   */
  function draw(result, z) {
    const parent = canvas.parentElement;
    const W = parent.clientWidth, H = parent.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!result || !result.layers.some(l => l.n > 0)) return;

    const { layers, input } = result;
    const d = input.wireDia, kappa = input.kappa;
    const R = result.dOut / 2;
    const scale = Math.min(W, H) * 0.44 / R;
    const cx = W / 2, cy = H / 2;

    // 外接圆
    ctx.beginPath();
    ctx.arc(cx, cy, R * scale, 0, 2 * Math.PI);
    ctx.strokeStyle = '#9fb0bd'; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);

    // 中心丝
    ctx.beginPath();
    ctx.arc(cx, cy, (d * kappa / 2) * scale, 0, 2 * Math.PI);
    ctx.fillStyle = '#b8b0a0'; ctx.fill();
    ctx.strokeStyle = '#00000033'; ctx.stroke();

    layers.forEach((L, li) => {
      if (L.n === 0) return;
      const color = LAYER_COLORS[li % LAYER_COLORS.length];
      const rot = L.dir * 2 * Math.PI * z / L.lay; // z 处该层整体转角
      for (let j = 0; j < L.n; j++) {
        const th = rot + (2 * Math.PI * j) / L.n;
        if (input.mode === 'compact') {
          // 扇形单丝:节圆两侧 ±dκ/2 圆环扇形,半角 π/n(留 2% 缝)
          const beta = (Math.PI / L.n) * 0.98;
          const ri = (L.radius - (d * kappa) / 2) * scale;
          const ro = (L.radius + (d * kappa) / 2) * scale;
          ctx.beginPath();
          ctx.arc(cx, cy, ro, th - beta, th + beta);
          ctx.arc(cx, cy, ri, th + beta, th - beta, true);
          ctx.closePath();
          ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = '#0000002e'; ctx.stroke();
        } else {
          const x = cx + L.radius * Math.cos(th) * scale;
          const y = cy + L.radius * Math.sin(th) * scale;
          ctx.beginPath();
          ctx.arc(x, y, (d / 2) * scale, 0, 2 * Math.PI);
          ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = '#0000002e'; ctx.stroke();
        }
      }
    });

    // 标注
    ctx.fillStyle = '#6b7a86';
    ctx.font = '12px Microsoft YaHei, sans-serif';
    ctx.fillText(`z = ${z.toFixed(1)} mm   外径 Ø${result.dOut.toFixed(2)} mm   共 ${result.totalWires} 根`, 12, 20);
    let lx = 12;
    const ly = H - 12;
    layers.forEach((L, li) => {
      if (L.n === 0) return;
      ctx.fillStyle = LAYER_COLORS[li % LAYER_COLORS.length];
      ctx.fillRect(lx, ly - 9, 10, 10);
      ctx.fillStyle = '#4a5a66';
      const t = ` ${L.index}层×${L.n}`;
      ctx.fillText(t, lx + 13, ly);
      lx += 13 + ctx.measureText(t).width + 14;
    });
  }

  return { draw };
}
