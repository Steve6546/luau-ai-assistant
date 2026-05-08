/** Gzip + base64 helpers using the Web Compression Streams API. */
async function streamToBytes(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = s.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export interface CompressedPayload { _gz: true; data: string }

/** Compress JSON-serializable data to gzip+base64 if larger than threshold. */
export async function maybeCompress(data: unknown, thresholdBytes = 32 * 1024): Promise<unknown> {
  try {
    const json = JSON.stringify(data);
    if (json.length < thresholdBytes || typeof CompressionStream === "undefined") return data;
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = await streamToBytes(stream);
    return { _gz: true, data: bytesToB64(bytes) } satisfies CompressedPayload;
  } catch {
    return data;
  }
}

export function isCompressed(v: unknown): v is CompressedPayload {
  return !!v && typeof v === "object" && (v as { _gz?: unknown })._gz === true && typeof (v as { data?: unknown }).data === "string";
}

/** Decompress a payload produced by maybeCompress. Returns original parsed JSON. */
export async function decompress(v: unknown): Promise<unknown> {
  if (!isCompressed(v)) return v;
  const bin = atob(v.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const out = await streamToBytes(stream);
  return JSON.parse(new TextDecoder().decode(out));
}