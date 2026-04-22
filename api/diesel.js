function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
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

function textFromCell(cell) {
  return cell
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function inspectSource(name, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      ms: Date.now() - startedAt,
      latest: Array.isArray(result) ? result.at(-1) : result,
      count: Array.isArray(result) ? result.length : undefined,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function fetchEiaWeeklyDiesel() {
  const response = await fetchWithTimeout(
    "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=EMD_EPD2D_PTE_NUS_DPG",
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    },
  );
  if (!response.ok) throw new Error(`EIA weekly ${response.status}`);

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

  if (points.length === 0) throw new Error("EIA weekly parse");
  return points.slice(-180);
}

async function fetchFredWeeklyDiesel() {
  const response = await fetchWithTimeout("https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/csv",
    },
  });
  if (!response.ok) throw new Error(`FRED weekly ${response.status}`);

  const csv = await response.text();
  const points = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, value] = line.split(",");
      return { x: date, y: Number(value) };
    })
    .filter((point) => Number.isFinite(point.y))
    .slice(-180);
  if (points.length === 0) throw new Error("FRED weekly parse");
  return points;
}

async function fetchEiaDailyDiesel() {
  const direct = await fetchEiaDailyHtml()
    .then(parseEiaDailyDieselHtml)
    .catch(() => null);
  if (direct) return direct;

  const mirrored = await fetchEiaDailyTextMirror()
    .then(parseEiaDailyDieselText)
    .catch(() => null);
  if (mirrored) return mirrored;

  throw new Error("EIA daily parse");
}

async function fetchEiaDailyHtml() {
  const response = await fetchWithTimeout("https://www.eia.gov/todayinenergy/prices.php", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });
  if (!response.ok) throw new Error(`EIA daily HTML ${response.status}`);
  return response.text();
}

async function fetchEiaDailyTextMirror() {
  const response = await fetchWithTimeout(
    "https://r.jina.ai/http://r.jina.ai/http://https://www.eia.gov/todayinenergy/prices.php",
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/plain",
      },
    },
  );
  if (!response.ok) throw new Error(`EIA daily mirror ${response.status}`);
  return response.text();
}

function parseEiaDailyDieselHtml(html) {
  const dateMatch = html.match(/Retail Petroleum Prices[\s\S]*?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/i);
  const dieselCells = (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [])
    .map((row) =>
      [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
        textFromCell(match[1]),
      ),
    )
    .find((cells) => cells[0] === "Diesel" && cells[1] === "U.S. Average");
  const dieselPrice = Number(dieselCells?.[2]);
  if (!dateMatch || !Number.isFinite(dieselPrice)) return null;

  return {
    x: `20${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`,
    y: dieselPrice,
  };
}

function parseEiaDailyDieselText(text) {
  const dateMatch = text.match(/Retail Petroleum Prices.*?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/i);
  const dieselMatch = text.match(/^Diesel\s+U\.S\. Average\s+([\d.]+)/im);
  if (!dateMatch || !dieselMatch) return null;

  return {
    x: `20${dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`,
    y: Number(dieselMatch[1]),
  };
}

async function fetchDieselSeries() {
  const weekly = await fetchEiaWeeklyDiesel().catch(() => fetchFredWeeklyDiesel());
  const daily = await fetchEiaDailyDiesel().catch(() => null);

  if (daily && daily.x > weekly.at(-1).x) {
    return [...weekly, daily].slice(-180);
  }
  return weekly;
}

module.exports = {
  fetchDieselSeries,
  fetchEiaDailyDiesel,
  fetchEiaWeeklyDiesel,
  fetchFredWeeklyDiesel,
  inspectSource,
  json,
};
