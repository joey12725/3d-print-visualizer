// Share links. The main viewer site is published to here.now with proxy routes
// (public/.herenow/proxy.json) that hold a here.now API key server-side. Sharing creates
// a brand new here.now Site containing a copy of this viewer, the gzipped G-code and a
// small manifest, published with a 14 day TTL so here.now deletes it automatically.

import { gzippedGcode } from '../gcode/source';
import type { PrinterId } from '../render/printers';

export const SHARE_TTL_DAYS = 14;
export const SHARE_TTL_S = SHARE_TTL_DAYS * 24 * 3600;
export const SHARE_GCODE = 'print.gcode.gz';
export const SHARE_MANIFEST = 'share.json';

export interface ShareManifest {
  v: 1;
  name: string;
  createdAt: string;
  expiresAt: string;
  printer: PrinterId;
  bytes: number;
  thumbnail?: string;
}

export interface SavedShare {
  url: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  thumbnail?: string;
}

const LIST_KEY = 'pv.shares.v1';

export function savedShares(): SavedShare[] {
  try {
    const list: SavedShare[] = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    const now = Date.now();
    return list.filter((s) => new Date(s.expiresAt).getTime() > now);
  } catch {
    return [];
  }
}

function remember(s: SavedShare) {
  const list = [s, ...savedShares().filter((x) => x.url !== s.url)].slice(0, 50);
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
}

export function forgetShare(url: string) {
  localStorage.setItem(LIST_KEY, JSON.stringify(savedShares().filter((x) => x.url !== url)));
}

/** When this page *is* a share, returns its manifest. */
export async function loadShareManifest(): Promise<ShareManifest | null> {
  try {
    const res = await fetch(`./${SHARE_MANIFEST}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const m = await res.json();
    return m && m.v === 1 ? (m as ShareManifest) : null;
  } catch {
    return null;
  }
}

export async function fetchSharedGcode(onProgress: (f: number) => void): Promise<Blob> {
  const res = await fetch(`./${SHARE_GCODE}`);
  if (!res.ok || !res.body) throw new Error(`Could not download the shared G-code (${res.status}). The link may have expired.`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  return new Blob(parts as BlobPart[]);
}

/** Sharing only works on the main site (it owns the proxy routes). */
export function canShare(isShare: boolean): boolean {
  if (isShare) return false;
  if (import.meta.env.VITE_SHARE_ENABLED === '1') return true;
  return location.hostname.endsWith('.here.now');
}

export interface ShareProgress {
  phase: 'compress' | 'upload' | 'finalize';
  fraction: number;
}

interface CreateResponse {
  slug: string;
  siteUrl: string;
  upload: { versionId: string; uploads: { path: string; url: string; headers: Record<string, string> }[] };
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: string } | null)?.message ?? (json as { error?: string } | null)?.error ?? text.slice(0, 200);
    throw new Error(`here.now ${res.status}: ${msg || res.statusText}`);
  }
  return json as T;
}

function put(url: string, headers: Record<string, string>, body: Blob, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    xhr.send(body);
  });
}

export async function createShare(opts: {
  file: Blob;
  entry?: string;
  name: string;
  printer: PrinterId;
  thumbnail?: string | null;
  onProgress: (p: ShareProgress) => void;
}): Promise<SavedShare> {
  const { onProgress } = opts;
  onProgress({ phase: 'compress', fraction: 0 });
  const [html, gz] = await Promise.all([
    fetch('/index.html', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('Could not read the viewer page');
      return r.blob();
    }),
    gzippedGcode(opts.file, opts.entry),
  ]);
  const now = new Date();
  const manifest: ShareManifest = {
    v: 1,
    name: opts.name,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SHARE_TTL_S * 1000).toISOString(),
    printer: opts.printer,
    bytes: gz.size,
    // keep thumbnails small; big ones bloat every page load
    thumbnail: opts.thumbnail && opts.thumbnail.length < 200_000 ? opts.thumbnail : undefined,
  };
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const files = [
    { path: 'index.html', blob: html, contentType: 'text/html; charset=utf-8' },
    { path: SHARE_GCODE, blob: gz, contentType: 'application/octet-stream' },
    { path: SHARE_MANIFEST, blob: manifestBlob, contentType: 'application/json; charset=utf-8' },
  ];
  const title = opts.name.replace(/\.gcode$/i, '').slice(0, 60);
  const created = await api<CreateResponse>('/api/share/create', {
    ttlSeconds: SHARE_TTL_S,
    displayName: `G-code · ${title}`.slice(0, 80),
    displayDescription: `Shared 3D print preview (expires ${manifest.expiresAt.slice(0, 10)})`,
    files: files.map((f) => ({ path: f.path, size: f.blob.size, contentType: f.contentType })),
  });

  const total = files.reduce((a, f) => a + f.blob.size, 0);
  const done = new Map<string, number>();
  const report = () => onProgress({ phase: 'upload', fraction: [...done.values()].reduce((a, b) => a + b, 0) / total });
  await Promise.all(
    created.upload.uploads.map((u) => {
      const f = files.find((x) => x.path === u.path);
      if (!f) return Promise.resolve();
      return put(u.url, u.headers ?? { 'Content-Type': f.contentType }, f.blob, (p) => {
        done.set(f.path, p * f.blob.size);
        report();
      });
    }),
  );
  onProgress({ phase: 'finalize', fraction: 1 });
  const fin = await api<{ siteUrl: string; publishStatus?: { expiresAt?: string | null } }>(`/api/share/site/${encodeURIComponent(created.slug)}/finalize`, {
    versionId: created.upload.versionId,
  });
  const saved: SavedShare = {
    url: fin.siteUrl ?? created.siteUrl,
    name: opts.name,
    createdAt: manifest.createdAt,
    expiresAt: fin.publishStatus?.expiresAt ?? manifest.expiresAt,
    thumbnail: manifest.thumbnail,
  };
  remember(saved);
  return saved;
}
