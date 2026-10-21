export interface MemoryForImage {
  date: string;
  title: string;
  upcoming: boolean;
}

/** A single, directly openable picture of the confirmed moments on this page. */
export async function renderMomentImage(entries: MemoryForImage[], since: string): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  const footerY = 400 + entries.length * 221;
  canvas.height = footerY + 116;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('图片绘制不可用');

  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  const paper = color('--paper');
  const sheet = color('--sheet');
  const ink = color('--ink');
  const muted = color('--muted-foreground');
  const rose = color('--rose');
  const line = color('--line-strong');
  const serif = '"Noto Serif SC", "Songti SC", serif';

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // A quiet paper grain, drawn rather than fetched, keeps the picture self-contained.
  ctx.fillStyle = 'rgba(74, 60, 54, .035)';
  for (let i = 0; i < 900; i += 1) {
    const x = (i * 7919) % 1200;
    const y = (i * 104729) % canvas.height;
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, 1);
  }

  ctx.fillStyle = ink;
  ctx.font = `34px ${serif}`;
  ctx.fillText('loveuhqq', 84, 98);
  ctx.fillStyle = rose;
  ctx.font = `30px ${serif}`;
  ctx.fillText('♥', 261, 98);

  ctx.fillStyle = ink;
  ctx.font = `64px ${serif}`;
  ctx.fillText('记下的日子', 84, 210);
  ctx.fillStyle = muted;
  ctx.font = `25px ${serif}`;
  ctx.fillText(`始于 ${since.replaceAll('-', '.')}`, 88, 257);

  for (const [index, entry] of entries.entries()) {
    const x = index % 2 === 0 ? 84 : 102;
    const y = 322 + index * 221;
    const width = 1014;
    const height = 194;
    ctx.save();
    ctx.shadowColor = 'rgba(70, 45, 30, .13)';
    ctx.shadowBlur = 19;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = sheet;
    ctx.fillRect(x, y, width, height);
    ctx.restore();

    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + height, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = line;
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x, y + height - 12); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = muted;
    ctx.font = `27px ${serif}`;
    ctx.fillText(entry.date.replaceAll('-', '.'), x + 48, y + 58);
    ctx.fillStyle = ink;
    ctx.font = `42px ${serif}`;
    ctx.fillText(entry.title, x + 48, y + 127, width - 96);
    if (entry.upcoming) {
      ctx.fillStyle = rose;
      ctx.font = `23px ${serif}`;
      ctx.textAlign = 'right';
      ctx.fillText('还没到', x + width - 42, y + 58);
      ctx.textAlign = 'left';
    }
  }

  ctx.strokeStyle = line;
  ctx.beginPath(); ctx.moveTo(84, footerY); ctx.lineTo(1116, footerY); ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = `25px ${serif}`;
  ctx.fillText('往后。未完待续。', 84, footerY + 49);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.type !== 'image/png') throw new Error('图片生成失败');
  return blob;
}
