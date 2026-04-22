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

async function fetchYahoo(symbol) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 60 * 60 * 24 * 365 * 3;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1mo`;
  const response = await fetch(url, {
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
  // FRED mirrors the EIA weekly U.S. No. 2 diesel retail price series without an API key.
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW";
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/csv",
    },
  });
  if (!response.ok) throw new Error(`FRED diesel ${response.status}`);
  const csv = await response.text();
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, value] = line.split(",");
      return { x: date, y: Number(value) };
    })
    .filter((point) => Number.isFinite(point.y))
    .slice(-180);
}

module.exports = async function handler(req, res) {
  try {
    const entries = await Promise.all(
      Object.entries(yahooSeries).map(async ([key, symbol]) => [key, await fetchYahoo(symbol)])
    );
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
