import http from "node:http";

const port = Number(process.env.NEWS_PROXY_PORT || 8788);
const apiKey = process.env.NEWS_API_KEY;

if (!apiKey) {
  console.error("NEWS_API_KEY is required to run the news proxy.");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const incomingUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const query = incomingUrl.searchParams.get("q") || "";
    if (!query.trim()) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required query param: q" }));
      return;
    }

    const target = new URL("https://newsapi.org/v2/everything");
    target.searchParams.set("q", query);
    target.searchParams.set(
      "language",
      incomingUrl.searchParams.get("language") || "en"
    );
    target.searchParams.set(
      "sortBy",
      incomingUrl.searchParams.get("sortBy") || "publishedAt"
    );
    target.searchParams.set(
      "pageSize",
      incomingUrl.searchParams.get("pageSize") || "5"
    );
    target.searchParams.set("apiKey", apiKey);

    const response = await fetch(target.toString(), {
      headers: {
        "User-Agent": "MarketScout/1.0",
        "X-Api-Key": apiKey
      }
    });

    const body = await response.text();
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "application/json"
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error) }));
  }
});

server.listen(port, () => {
  console.log(`News proxy listening on http://localhost:${port}`);
});
