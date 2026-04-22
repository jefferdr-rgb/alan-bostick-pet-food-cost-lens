const { fetchDieselSeries } = require("./diesel");

const yahooSeries = {
  corn: "ZC=F",
  soybean: "ZM=F",
  oil: "ZL=F",
  rice: "ZR=F",
  wheat: "ZW=F",
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.end(JSON.stringify(body));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahoo(symbol) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 60 * 60 * 24 * 365 * 3;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1mo`;
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Yahoo ${symbol} ${response.status}`);
  const json = await response.json();
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return timestamps
    .map((timestamp, index) => ({
      x: new Date(timestamp * 1000).toISOString().slice(0, 10),
      y: Math.round(Number(closes[index]) * 100) / 100,
    }))
    .filter((point) => Number.isFinite(point.y));
}

async function fetchEiaDiesel() {
  return fetchDieselSeries();
}

module.exports = async function handler(req, res) {
  try {
    const settledEntries = await Promise.allSettled(
      Object.entries(yahooSeries).map(async ([key, symbol]) => [key, await fetchYahoo(symbol)]),
    );
    const entries = settledEntries
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const data = Object.fromEntries(entries);

    data.diesel = await fetchEiaDiesel();

    json(res, 200, {
      mode: "live",
      updatedAt: new Date().toISOString(),
      data,
    });
  } catch (error) {
    json(res, 502, {
      mode: "error",
      updatedAt: new Date().toISOString(),
      error: error.message,
    });
  }
};
