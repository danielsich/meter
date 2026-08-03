import type { ClockworkExport } from './clockwork';
import {
  buildScale,
  formatMinutes,
  formatNumber,
  formatTick,
} from './display';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** Render the current meter panel to a PNG and trigger a download. */
export function exportMeterPNG(data: ClockworkExport): void {
  const projects = [...data.projects].sort(
    (a, b) => b.totals.minutes - a.totals.minutes,
  );
  if (!projects.length) return;

  const DPR = 2;
  const W = 880;
  const PX = 28, PT = 56, PB = 28;
  const ROW_H = 48, GAP = 8;
  const H = PT + projects.length * (ROW_H + GAP) - GAP + PB;

  const canvas = document.createElement('canvas');
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);

  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fillStyle = '#171e25';
  ctx.fill();
  ctx.strokeStyle = '#2b3743';
  ctx.lineWidth = 1;
  ctx.stroke();

  const { axisMax, ticks } = buildScale(projects[0].totals.minutes);
  const cL = PX, cR = W - PX;
  const cW = cR - cL;

  ctx.font = `11px 'JetBrains Mono', monospace`;
  ctx.fillStyle = '#8a97a2';
  ctx.textAlign = 'center';
  for (const tick of ticks) {
    const x = cL + (tick / axisMax) * cW;
    ctx.fillText(formatTick(tick), x, PT - 18);
    ctx.strokeStyle = '#2b3743';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, PT - 13);
    ctx.lineTo(x, PT - 9);
    ctx.stroke();
  }

  ctx.strokeStyle = '#2b3743';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  for (const tick of ticks) {
    const x = cL + (tick / axisMax) * cW;
    ctx.beginPath();
    ctx.moveTo(x, PT);
    ctx.lineTo(x, H - PB);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  projects.forEach((project, index) => {
    const y = PT + index * (ROW_H + GAP);
    const barWidth = (project.totals.minutes / axisMax) * cW;

    roundRect(ctx, cL, y, cW, ROW_H, 9);
    ctx.fillStyle = '#1f2831';
    ctx.fill();
    ctx.strokeStyle = '#2b3743';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (barWidth > 0) {
      const gradient = ctx.createLinearGradient(cL, 0, cL + barWidth, 0);
      gradient.addColorStop(0, 'rgba(216,162,74,0.16)');
      gradient.addColorStop(1, 'rgba(216,162,74,0.24)');
      roundRect(ctx, cL, y, barWidth, ROW_H, 9);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.save();
      ctx.shadowColor = 'rgba(216,162,74,0.4)';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#f0c46a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cL + barWidth, y + 1);
      ctx.lineTo(cL + barWidth, y + ROW_H - 1);
      ctx.stroke();
      ctx.restore();
    }

    const mid = y + ROW_H / 2 + 5;

    ctx.font = `12px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#8a97a2';
    ctx.textAlign = 'left';
    ctx.fillText(String(index + 1).padStart(2, '0'), cL + 12, mid);

    ctx.font = `500 14px 'Space Grotesk', system-ui`;
    ctx.fillStyle = '#e8e4d9';
    const maxNameWidth = cW * 0.45;
    let name = project.name;
    while (name.length > 3 && ctx.measureText(name).width > maxNameWidth) {
      name = name.slice(0, -1);
    }
    if (name !== project.name) name += '…';
    ctx.fillText(name, cL + 40, mid);

    ctx.font = `500 13px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#e8e4d9';
    ctx.textAlign = 'right';
    ctx.fillText(formatMinutes(project.totals.minutes), cR - 78, mid);

    ctx.fillStyle = '#64b6a4';
    ctx.fillText(`${formatNumber(project.totals.prompts)} p`, cR - 8, mid);
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'meter.png';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 'image/png');
}
