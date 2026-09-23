/**
 * The shared memory chunker, loaded into the dashboard (MEMORY-002 D1).
 *
 * `extension/shared/memory-chunk.js` decides where a long text is cut into
 * shard-sized pieces. The extension's chat capture already uses it, and the
 * document upload has the identical problem, so it loads the same file at
 * runtime rather than carrying a second splitter: two implementations would
 * eventually disagree, and the same file would chunk differently depending on
 * whether it arrived through the extension or through this page.
 *
 * Loaded the same way `fillFormEngine.ts` loads the formula engine, from
 * `/extension/*`, which `extensionScriptsPlugin` serves in dev and copies into
 * dist at build.
 */

export interface SbChunkResult {
  chunks: string[];
  /** Pieces that had to be cut mid-paragraph, reported rather than hidden. */
  forced: number;
}

export interface SbMemoryChunkApi {
  MAX_BODY: number;
  chunkText(text: string, limit?: number): SbChunkResult;
  chunkBlocks(blocks: string[], limit?: number): SbChunkResult;
}

declare global {
  interface Window {
    SBMemoryChunk?: SbMemoryChunkApi;
  }
}

const CHUNKER_SRC = '/extension/shared/memory-chunk.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-sb-engine="${src}"]`);
    if (existing) {
      if (existing.dataset.sbLoaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), {
        once: true,
      });
      return;
    }

    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.dataset.sbEngine = src;
    el.addEventListener(
      'load',
      () => {
        el.dataset.sbLoaded = 'true';
        resolve();
      },
      { once: true },
    );
    el.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.head.appendChild(el);
  });
}

/** The chunker, loading it on first use. Throws if the file cannot be served. */
export async function loadMemoryChunk(): Promise<SbMemoryChunkApi> {
  if (window.SBMemoryChunk) return window.SBMemoryChunk;
  await loadScript(CHUNKER_SRC);
  const api = window.SBMemoryChunk;
  if (!api) throw new Error('The text splitter did not load');
  return api;
}
