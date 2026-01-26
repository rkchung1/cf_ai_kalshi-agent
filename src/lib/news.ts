export type Article = {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  description: string;
};

function getNewsApiKey(fallback?: string): string | undefined {
  if (fallback) return fallback;
  if (typeof process !== "undefined" && process.env?.NEWS_API_KEY) {
    return process.env.NEWS_API_KEY;
  }
  return undefined;
}

function getNewsApiProxyUrl(fallback?: string): string | undefined {
  if (fallback) return fallback;
  if (typeof process !== "undefined" && process.env?.NEWS_API_PROXY_URL) {
    return process.env.NEWS_API_PROXY_URL;
  }
  return undefined;
}

type NewsApiResult = {
  articles: Article[];
  error?: string;
};

async function fetchTopNewsWithStatus(
  query: string,
  apiKeyOverride?: string,
  proxyUrlOverride?: string
): Promise<NewsApiResult> {
  const apiKey = getNewsApiKey(apiKeyOverride);
  const proxyUrl = getNewsApiProxyUrl(proxyUrlOverride);
  if (!query.trim()) return { articles: [] };
  if (!apiKey && !proxyUrl) {
    return { articles: [], error: "NEWS_API_KEY missing" };
  }

  const url = new URL(proxyUrl || "https://newsapi.org/v2/everything");
  url.searchParams.set("q", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("searchIn", "title,description");
  url.searchParams.set("pageSize", "20");
  if (apiKey) {
    url.searchParams.set("apiKey", apiKey);
  }

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }
  headers["User-Agent"] = "MarketScout/1.0";

  try {
    const response = await fetch(url.toString(), {
      headers
    });

    if (!response.ok) {
      let errorText = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { message?: string };
        if (body?.message) {
          errorText = `${errorText}: ${body.message}`;
        }
      } catch {
        // ignore parse errors
      }
      return { articles: [], error: errorText };
    }

    const payload = (await response.json()) as {
      articles?: Array<{
        title?: string;
        source?: { name?: string };
        publishedAt?: string;
        url?: string;
        description?: string;
      }>;
    };

    const articles = (payload.articles ?? [])
      .map((article) => ({
        title: article.title ?? "",
        source: article.source?.name ?? "",
        publishedAt: article.publishedAt ?? "",
        url: article.url ?? "",
        description: article.description ?? ""
      }))
      .filter((article) => article.title);

    return {
      articles: articles.sort((a, b) =>
        String(b.publishedAt).localeCompare(String(a.publishedAt))
      )
    };
  } catch (error) {
    return { articles: [], error: String(error) };
  }
}

export async function fetchTopNews(
  query: string,
  apiKeyOverride?: string,
  proxyUrlOverride?: string
): Promise<Article[]> {
  const result = await fetchTopNewsWithStatus(
    query,
    apiKeyOverride,
    proxyUrlOverride
  );
  return result.articles;
}

export async function fetchTopNewsWithFallback(
  queries: string[],
  apiKeyOverride?: string,
  proxyUrlOverride?: string
): Promise<{ articles: Article[]; usedQueries: string[]; errors: string[] }> {
  const usedQueries: string[] = [];
  const byUrl = new Map<string, Article>();
  const errors: string[] = [];

  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    if (usedQueries.includes(trimmed)) continue;

    const { articles, error } = await fetchTopNewsWithStatus(
      trimmed,
      apiKeyOverride,
      proxyUrlOverride
    );
    usedQueries.push(trimmed);
    if (error) {
      errors.push(`${trimmed}: ${error}`);
    }
    for (const article of articles) {
      const key = article.url || `${article.title}-${article.publishedAt}`;
      if (!byUrl.has(key)) {
        byUrl.set(key, article);
      }
    }

    if (byUrl.size >= 10) break;
  }

  const articles = Array.from(byUrl.values())
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 10);

  return { articles, usedQueries, errors };
}
