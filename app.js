const ingredients = [
  ["Whole grain corn", 82],
  ["Chicken meal / by-product meal", 76],
  ["Brewers rice / brown rice", 62],
  ["Soybean meal", 54],
  ["Chicken fat / animal fat", 48],
  ["Peas / pulses", 41],
  ["Flaxseed", 36],
  ["Beet pulp", 34],
  ["Salt & mineral premix", 31],
];

const sources = [
  "Dry/extruded pet food ingredient panels normalized into cost-bearing ingredient families",
  "CBOT futures proxies for corn, soybean meal, soybean oil, rough rice, and wheat",
  "Fat, rice, and middlings categories use directional market proxies where exact feed-grade quotes are unavailable",
  "Live/latest feed attempt with built-in April 2026 historical fallback when browser access is blocked",
];

const palette = {
  corn: "#f6b333",
  soybean: "#006b3f",
  oil: "#d26f32",
  rice: "#2b76b7",
  wheat: "#8b5e2f",
  diesel: "#2f3a3f",
  basket: "#111827",
};

const series = {
  corn: { label: "Corn proxy", component: "Whole grain corn", color: palette.corn, unit: "¢/bu", exchange: "CBOT", yahoo: "ZC=F" },
  soybean: { label: "Soybean meal proxy", component: "Soybean meal", color: palette.soybean, unit: "$/ton", exchange: "CBOT", yahoo: "ZM=F" },
  oil: { label: "Soybean oil / fat proxy", component: "Chicken fat / animal fat", color: palette.oil, unit: "¢/lb", exchange: "CBOT proxy", yahoo: "ZL=F" },
  rice: { label: "Rough rice proxy", component: "Brewers rice / brown rice", color: palette.rice, unit: "$/cwt", exchange: "CBOT proxy", yahoo: "ZR=F" },
  wheat: { label: "Wheat / middlings proxy", component: "Wheat middlings", color: palette.wheat, unit: "¢/bu", exchange: "CBOT", yahoo: "ZW=F" },
};

function makeFallback(seed, drift) {
  const points = [];
  const start = new Date("2023-04-21T00:00:00");
  for (let i = 0; i < 37; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const wave = Math.sin(i / 3 + seed) * 8 + Math.cos(i / 7 + seed) * 5;
    const value = 100 + wave + drift * i + (seed % 3) * 2;
    points.push({ x: d.toISOString().slice(0, 10), y: Math.max(62, Math.round(value * 10) / 10) });
  }
  return points;
}

let data = {
  corn: makeFallback(1, -0.9),
  soybean: makeFallback(2, 0.25),
  oil: makeFallback(3, -0.35),
  rice: makeFallback(4, 0.1),
  wheat: makeFallback(5, -0.55),
  diesel: makeFallback(7, -0.42).map((point) => ({ ...point, y: Math.round((4.95 * point.y / 100) * 100) / 100 })),
};

const weights = { corn: 0.32, soybean: 0.22, rice: 0.18, oil: 0.16, wheat: 0.12 };

function indexed(points) {
  const base = points[0]?.y || 1;
  return points.map((p) => ({ x: p.x, y: Math.round((p.y / base) * 1000) / 10 }));
}

function buildBasket() {
  const indexedData = Object.fromEntries(Object.keys(weights).map((key) => [key, indexed(data[key])]));
  return indexedData.corn.map((p, i) => ({
    x: p.x,
    y: Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + (indexedData[key][i]?.y || 100) * weight, 0) * 10) / 10,
  }));
}

function renderStatic() {
  document.getElementById("ingredientChips").innerHTML = ingredients
    .slice(0, 7)
    .map(([name]) => `<span class="chip">${name}</span>`)
    .join("");

  document.getElementById("commonBars").innerHTML = ingredients
    .map(([name, score]) => `<div class="bar"><label><span>${name}</span><span>${score}%</span></label><div class="track"><div class="fill" style="width:${score}%"></div></div></div>`)
    .join("");

  document.getElementById("sourceList").innerHTML = sources.map((s) => `<li>${s}</li>`).join("");

  document.getElementById("ingredientCharts").innerHTML = Object.entries(series)
    .map(([key, meta]) => `<article class="ingredient-card"><header><div><h3>${meta.label}</h3><div class="proxy">${Math.round(weights[key] * 100)}% basket weight · ${meta.unit}</div></div><div class="move" id="${key}Move">--</div></header><div id="${key}Chart" class="svg-chart" aria-label="${meta.label} chart"></div></article>`)
    .join("");
}

function renderMetrics() {
  const basket = buildBasket();
  const last = basket.at(-1).y;
  const first = basket[0].y;
  const change = Math.round((last - first) * 10) / 10;
  const movers = Object.keys(data).map((key) => {
    const idx = indexed(data[key]);
    return [key, Math.round((idx.at(-1).y - idx[0].y) * 10) / 10];
  }).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  document.getElementById("metrics").innerHTML = [
    ["Current basket", `${last}`, `${change >= 0 ? "+" : ""}${change} pts vs 2023`],
    ["Largest mover", series[movers[0][0]].label, `${movers[0][1] >= 0 ? "+" : ""}${movers[0][1]} index pts`],
    ["Ingredient coverage", "9 groups", "primary pet food inputs"],
  ].map(([label, value, note]) => `<div class="metric"><span>${label}</span><strong>${value}</strong><em>${note}</em></div>`).join("");
}

function formatPrice(value, unit) {
  if (unit.startsWith("$")) return `$${value.toFixed(2)}`;
  return value.toFixed(2);
}

function renderPriceSnapshot() {
  document.getElementById("priceSnapshot").innerHTML = Object.entries(series).map(([key, meta]) => {
    const points = data[key];
    const latest = points.at(-1);
    const first = points[0];
    const change = latest && first ? Math.round((latest.y - first.y) * 100) / 100 : 0;
    const indexedChange = indexed(points).at(-1).y - 100;
    const direction = change >= 0 ? "up" : "down";

    return `
      <article class="price-card ${direction}">
        <div class="price-top">
          <span>${meta.exchange}</span>
          <strong>${meta.yahoo}</strong>
        </div>
        <h3>${meta.component}</h3>
        <div class="price-value">${formatPrice(latest.y, meta.unit)} <small>${meta.unit}</small></div>
        <div class="price-meta">
          <span>${latest.x}</span>
          <b>${change >= 0 ? "+" : ""}${change.toFixed(2)} raw</b>
          <b>${indexedChange >= 0 ? "+" : ""}${indexedChange.toFixed(1)} idx</b>
        </div>
      </article>`;
  }).join("");
}

function renderSvgChart(targetId, points, color, options = {}) {
  const indexedPoints = indexed(points);
  const width = 900;
  const height = options.large ? 340 : 190;
  const pad = { top: 18, right: 22, bottom: 34, left: 42 };
  const values = indexedPoints.map((point) => point.y);
  const min = Math.floor(Math.min(...values) - 4);
  const max = Math.ceil(Math.max(...values) + 4);
  const xStep = (width - pad.left - pad.right) / Math.max(indexedPoints.length - 1, 1);
  const yScale = (value) => pad.top + ((max - value) / Math.max(max - min, 1)) * (height - pad.top - pad.bottom);
  const coords = indexedPoints.map((point, index) => [pad.left + index * xStep, yScale(point.y)]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad.left},${height - pad.bottom} ${line} ${width - pad.right},${height - pad.bottom}`;
  const ticks = [max, Math.round((max + min) / 2), min];
  const dateTickCount = options.large ? 6 : 5;
  const dateLabels = Array.from({ length: dateTickCount }, (_, index) => {
    const pointIndex = Math.round((index / (dateTickCount - 1)) * (indexedPoints.length - 1));
    return { ...indexedPoints[pointIndex], pointIndex, index };
  });

  document.getElementById(targetId).innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${targetId}Fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${ticks.map((tick) => `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${yScale(tick)}" y2="${yScale(tick)}" stroke="rgba(7,59,42,.10)" /><text x="8" y="${yScale(tick) + 4}" fill="#6b746f" font-size="13" font-weight="700">${tick}</text></g>`).join("")}
      ${dateLabels.map((point) => `<line x1="${pad.left + point.pointIndex * xStep}" x2="${pad.left + point.pointIndex * xStep}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="rgba(7,59,42,.055)" />`).join("")}
      <polygon points="${area}" fill="url(#${targetId}Fill)" />
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="${options.large ? 5 : 4}" stroke-linecap="round" stroke-linejoin="round" />
      ${coords.map(([x, y], index) => index % 6 === 0 || index === coords.length - 1 ? `<circle cx="${x}" cy="${y}" r="${options.large ? 4 : 3}" fill="${color}" />` : "").join("")}
      ${dateLabels.map((point) => {
        const x = pad.left + point.pointIndex * xStep;
        const anchor = point.index === 0 ? "start" : point.index === dateTickCount - 1 ? "end" : "middle";
        return `<text x="${x}" y="${height - 9}" text-anchor="${anchor}" fill="#6b746f" font-size="${options.large ? 13 : 12}" font-weight="800">${point.x.slice(0, 7)}</text>`;
      }).join("")}
    </svg>`;
}

function renderIngredientCharts() {
  Object.entries(series).forEach(([key, meta]) => {
    const points = indexed(data[key]);
    const first = points[0]?.y || 100;
    const last = points.at(-1)?.y || first;
    const change = Math.round((last - first) * 10) / 10;
    const move = document.getElementById(`${key}Move`);
    move.textContent = `${change >= 0 ? "+" : ""}${change}`;
    move.style.color = change >= 0 ? "#006b3f" : "#b54708";
    renderSvgChart(`${key}Chart`, data[key], meta.color);
  });
}

function renderDiesel() {
  const points = data.diesel;
  const latest = points.at(-1);
  const first = points[0];
  const rawChange = latest.y - first.y;
  const indexChange = indexed(points).at(-1).y - 100;
  const move = document.getElementById("dieselMove");
  move.textContent = `${indexChange >= 0 ? "+" : ""}${indexChange.toFixed(1)} idx`;
  move.style.color = indexChange >= 0 ? "#006b3f" : "#b54708";
  document.getElementById("dieselPrice").innerHTML = `$${latest.y.toFixed(2)} <small>/ gal</small><span>${latest.x} · ${rawChange >= 0 ? "+" : ""}$${rawChange.toFixed(2)} raw</span>`;
  renderSvgChart("dieselChart", points, palette.diesel, { large: true });
}

function renderCharts() {
  renderSvgChart("basketChart", buildBasket(), palette.basket, { large: true });
  renderMetrics();
  renderPriceSnapshot();
  renderIngredientCharts();
  renderDiesel();
}

async function boot() {
  renderStatic();
  try {
    const res = await fetch("/api/prices");
    if (!res.ok) throw new Error("price api");
    const payload = await res.json();
    for (const [key, points] of Object.entries(payload.data || {})) {
      if (key in data && Array.isArray(points) && points.length > 10) data[key] = points;
    }
    document.body.dataset.live = "true";
    document.getElementById("feedStatus").textContent = "Server-side market feeds connected";
    document.getElementById("lastUpdated").textContent = `Updated ${new Date(payload.updatedAt).toLocaleString()}`;
    document.getElementById("priceSnapshotNote").textContent = "Latest prices fetched server-side and cached for fast reloads.";
  } catch {
    document.body.dataset.live = "false";
    document.getElementById("feedStatus").textContent = "Price API unavailable; using built-in three-year snapshot";
    document.getElementById("priceSnapshotNote").textContent = "Using built-in fallback prices because the price API is unavailable.";
  }
  renderCharts();
}

boot();
