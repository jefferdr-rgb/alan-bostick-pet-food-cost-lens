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
  const eiaPoints = await fetchEiaDieselTable().catch(() => []);
  if (eiaPoints.length > 0) return eiaPoints;

  // FRED mirrors the EIA weekly U.S. No. 2 diesel retail price series without an API key.
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW";
  const response = await fetchWithTimeout(url, {
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

function textFromCell(cell) {
  return cell
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchEiaDieselTable() {
  const url =
    "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=EMD_EPD2D_PTE_NUS_DPG";
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });
  if (!response.ok) throw new Error(`EIA diesel table ${response.status}`);

  const html = await response.text();
  const monthNumbers = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  const points = [];
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];

  rows.forEach((row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
      textFromCell(match[1]),
    );
    const [, year, monthName] = cells[0]?.match(/^(\d{4})-([A-Z][a-z]{2})$/) || [];
    if (!year || !monthNumbers[monthName]) return;

    for (let index = 1; index < cells.length - 1; index += 2) {
      const date = cells[index];
      const value = Number(cells[index + 1]);
      const dateMatch = date.match(/^(\d{2})\/(\d{2})$/);
      if (!dateMatch || !Number.isFinite(value)) continue;

      points.push({
        x: `${year}-${dateMatch[1]}-${dateMatch[2]}`,
        y: value,
      });
    }
  });

  return points.slice(-180);
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
