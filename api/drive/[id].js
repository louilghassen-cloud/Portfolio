const CHUNK = 2 * 1024 * 1024;

const parseRange = (header) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header || '');
  if (!match) return { start: 0, end: null };
  return { start: Number(match[1]), end: match[2] ? Number(match[2]) : null };
};

export default async function handler(req, res) {
  const raw = req.query.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    res.status(400).end('Bad id');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.status(405).end();
    return;
  }

  const { start, end } = parseRange(req.headers.range);
  const cappedEnd = end == null ? start + CHUNK - 1 : Math.min(end, start + CHUNK - 1);
  const upstreamUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Range: `bytes=${start}-${cappedEnd}`
      },
      redirect: 'follow'
    });
  } catch {
    res.status(502).end('Upstream failed');
    return;
  }

  const type = upstream.headers.get('content-type') || '';
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (type.includes('text/html') || declared > CHUNK + 65536) {
    await upstream.body?.cancel?.();
    res.status(502).end('Drive did not return a video range');
    return;
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const contentRange = upstream.headers.get('content-range');
  if (start === 0 && bytes.length >= 8 && bytes.subarray(4, 8).toString() !== 'ftyp') {
    res.status(502).end('Drive did not return video');
    return;
  }

  res.status(contentRange ? 206 : upstream.status);
  res.setHeader('Content-Type', type.startsWith('video/') ? type : 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Length', String(bytes.length));
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(bytes);
}

export const config = {
  maxDuration: 60
};
