// The link-preview picture for a share: the print on its plate, framed like the page's
// default view, with the stage's backdrop and a caption (name, time, grams, printer).

import type { Viewer } from '../render/viewer';
import { OG_H, OG_W } from './social';

export interface OgCaption {
  title: string;
  line: string;
}

export function ogImage(viewer: Viewer, caption: OgCaption): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = OG_W;
  c.height = OG_H;
  const g = c.getContext('2d')!;

  // same backdrop as .stage: radial-gradient(120% 90% at 50% 35%, #26303b, #161b22 55%, #0d1014)
  g.save();
  g.translate(OG_W * 0.5, OG_H * 0.35);
  g.scale(1.2 * OG_W, 0.9 * OG_H);
  const bg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  bg.addColorStop(0, '#26303b');
  bg.addColorStop(0.55, '#161b22');
  bg.addColorStop(1, '#0d1014');
  g.fillStyle = bg;
  g.fillRect(-1, -1, 2, 2);
  g.restore();

  // render at 2x and scale down, so thin perimeters stay smooth
  g.imageSmoothingQuality = 'high';
  g.drawImage(viewer.snapshot(OG_W * 2, OG_H * 2), 0, 0, OG_W, OG_H);

  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const pad = 28;
  g.font = `600 34px ${font}`;
  const title = fit(g, caption.title, OG_W * 0.6);
  const tw = g.measureText(title).width;
  g.font = `500 24px ${font}`;
  const lw = g.measureText(caption.line).width;
  const w = Math.max(tw, lw) + pad * 2;
  g.fillStyle = 'rgba(13, 16, 20, 0.78)';
  g.beginPath();
  g.roundRect(24, 24, w, 112, 18);
  g.fill();
  g.fillStyle = '#f2f5f8';
  g.font = `600 34px ${font}`;
  g.fillText(title, 24 + pad, 24 + 50);
  g.fillStyle = '#9aa6b2';
  g.font = `500 24px ${font}`;
  g.fillText(caption.line, 24 + pad, 24 + 90);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the preview image'))), 'image/jpeg', 0.86));
}

function fit(g: CanvasRenderingContext2D, s: string, max: number) {
  if (g.measureText(s).width <= max) return s;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
