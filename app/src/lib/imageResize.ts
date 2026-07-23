// Client-side downscaling for uploaded images (TEAM-COVER-001 follow-up).
//
// A phone or camera photo is routinely 4–10 MB and several times wider than any
// surface renders it. Uploading the original would either be rejected by the
// bucket's size cap or force every viewer to download megabytes on each page
// load. So we decode, scale to a sensible longest edge, and re-encode as JPEG
// before upload — the size cap then applies to the processed image, which
// essentially always fits.

/**
 * Longest-edge target for a team cover. The cover band renders at most ~1600
 * CSS px wide (the dashboard's max content width), so 2560 leaves retina
 * headroom without storing a full-resolution original.
 */
export const COVER_MAX_WIDTH = 2560;

/** Quality ladder, tried in order until the encoded result fits under the cap. */
const QUALITY_STEPS = [0.85, 0.72, 0.6];

/**
 * Scale (width, height) down to fit `maxWidth`, preserving aspect ratio.
 * Never upscales, and never returns a zero dimension.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height };
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}

/** Swap a filename's extension for .jpg (the re-encoded output format). */
function toJpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '');
  return `${base || 'image'}.jpg`;
}

/**
 * Downscale + re-encode an image so it fits under `maxBytes`.
 *
 * Returns the original file untouched when it's already small enough (so an
 * in-spec PNG or WebP keeps its format), when it's an SVG (no raster to
 * resize), or when the browser can't decode it — in that last case the caller's
 * validation surfaces a clear error rather than this throwing.
 */
export async function downscaleImage(
  file: File,
  opts: { maxWidth: number; maxBytes: number },
): Promise<File> {
  if (file.type === 'image/svg+xml') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // undecodable — let validation report it
  }

  try {
    // Already within budget in both dimensions and bytes: keep the original.
    if (file.size <= opts.maxBytes && bitmap.width <= opts.maxWidth) return file;

    const { width, height } = fitWithin(bitmap.width, bitmap.height, opts.maxWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let smallest: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (!blob) continue;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= opts.maxBytes) break;
    }
    if (!smallest) return file;

    // Even the smallest attempt may exceed the cap on a pathological source;
    // hand it back anyway — it's smaller than the original, and validation
    // decides whether to accept it.
    return new File([smallest], toJpegName(file.name), { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
