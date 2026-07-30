const UA = "uk-jobs-ingest/1.0 (+github.com/abbiefang/uk-jobs-ingest)";

export async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown } | { status: 0; body: null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status >= 500 && attempt === 0) continue;
      const text = await res.text();
      try { return { status: res.status, body: JSON.parse(text) }; }
      catch { return { status: res.status, body: text }; }
    } catch {
      if (attempt === 0) continue;
    }
  }
  return { status: 0, body: null };
}

export function rateLimiter(ms: number): () => Promise<void> {
  let last = 0;
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(async () => {
      const wait = last + ms - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    return chain;
  };
}
