/**
 * stackedarea.js
 * Polished stacked area chart with toggle, small multiples, legend, and annotation.
 */
import { tooltip } from "../tooltip.js";

const PALETTE = ["#1B6CC4", "#0F9E7B", "#E09420", "#E07055", "#9A9A9A"];
const MARGIN = { top: 30, right: 20, bottom: 44, left: 56 };

let _container, _svg, _g, _finesRaw, _categories, _colorMap;
let _width, _height, _x, _y, _periods, _stackData, _mode, _hiddenCats;
let _lockedCat = null,
  _periodLabels;
let _lastFilterState = null;
const TRANSITION_MS = 400;

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function fmtMetric(m) {
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtY(d) {
  if (d >= 1e6) return (d / 1e6).toFixed(d % 1e6 ? 1 : 0) + "M";
  if (d >= 1e3) return (d / 1e3).toFixed(0) + "K";
  return d;
}

function buildGrouped(data) {
  const uniqueYears = [
    ...new Set(data.map((d) => d.YEAR).filter((y) => y != null)),
  ];
  let periodExtractor, periodLabel;
  if (uniqueYears.length <= 1 && data[0]?.START_DATE) {
    periodExtractor = (d) =>
      parseInt((d.START_DATE || "").split("-")[1], 10) || null;
    const mn = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    periodLabel = (d) => mn[d - 1] || String(d);
  } else {
    periodExtractor = (d) => d.YEAR;
    periodLabel = (d) => String(d);
  }

  const allMetrics = [...new Set(data.map((d) => d.METRIC).filter(Boolean))];
  console.log("Stacked area: METRIC values:", allMetrics);

  const map = new Map();
  for (const row of data) {
    const p = periodExtractor(row);
    if (p == null) continue;
    const key = `${p}|${row.METRIC || "unknown"}`;
    map.set(key, (map.get(key) || 0) + (row.FINES || 0));
  }

  const totals = new Map();
  for (const [k, v] of map) {
    const m = k.split("|")[1];
    totals.set(m, (totals.get(m) || 0) + v);
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top4 = sorted.slice(0, 4).map((d) => d[0]);
  const hasOther = sorted.length > 4;
  const categories = [...top4];
  if (hasOther) categories.push("Other");

  const colorMap = {};
  categories.forEach((c, i) => (colorMap[c] = PALETTE[i] || PALETTE[4]));
  const periods = [
    ...new Set(data.map(periodExtractor).filter((p) => p != null)),
  ].sort((a, b) => a - b);

  const stackData = periods.map((p) => {
    const row = { period: p, _label: periodLabel(p) };
    categories.forEach((c) => (row[c] = 0));
    return row;
  });
  for (const [k, v] of map) {
    const [ps, metric] = k.split("|");
    const p = parseInt(ps, 10);
    const sr = stackData.find((r) => r.period === p);
    if (!sr) continue;
    if (top4.includes(metric)) sr[metric] += v;
    else if (hasOther) sr["Other"] = (sr["Other"] || 0) + v;
  }
  return {
    categories,
    colorMap,
    periods,
    stackData,
    periodLabel,
    periodExtractor,
  };
}

export function initStackedArea(selector, finesData) {
  _finesRaw = finesData;
  _container = d3.select(selector);
  _container.html("");
  _mode = "absolute";
  _hiddenCats = new Set();
  _lockedCat = null;

  const r = buildGrouped(finesData);
  _categories = r.categories;
  _colorMap = r.colorMap;
  _periods = r.periods;
  _stackData = r.stackData;
  _periodLabels = r.periodLabel;

  // Toggle
  const toggle = _container.append("div").attr("class", "dualaxis-toggle");
  toggle
    .append("button")
    .attr("class", "toggle-btn active")
    .attr("data-mode", "absolute")
    .text("Absolute")
    .on("click", function () {
      setMode("absolute", toggle);
    });
  toggle
    .append("button")
    .attr("class", "toggle-btn")
    .attr("data-mode", "share")
    .text("Share of total (%)")
    .on("click", function () {
      setMode("share", toggle);
    });

  const cw = _container.node().clientWidth || 800;
  _width = cw - MARGIN.left - MARGIN.right;
  _height = 280;

  const svgH = _height + MARGIN.top + MARGIN.bottom;
  _svg = _container
    .append("svg")
    .attr("viewBox", `0 0 ${cw} ${svgH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr(
      "aria-label",
      "Stacked area chart showing composition of enforcement fine categories over time",
    )
    .style("width", "100%")
    .style("height", "auto")
    .style("max-height", svgH + "px");
  _svg
    .append("title")
    .text(
      "Stacked area chart showing composition of enforcement fine categories over time",
    );

  // Gradient defs for each category
  const defs = _svg.append("defs");
  _categories.forEach((c) => {
    const base = d3.color(_colorMap[c]);
    const grad = defs
      .append("linearGradient")
      .attr("id", "grad-" + c.replace(/\W/g, ""))
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 1);
    grad
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", base.brighter(0.3));
    grad
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", base.darker(0.2));
  });

  _g = _svg
    .append("g")
    .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  render(false);
  drawLegend();
}

function setMode(mode, toggle) {
  _mode = mode;
  toggle.selectAll(".toggle-btn").classed("active", false);
  toggle.select(`[data-mode="${mode}"]`).classed("active", true);
  render(true);
}

function activeCats() {
  return _categories.filter((c) => !_hiddenCats.has(c));
}

function render(animate) {
  _g.selectAll("*").remove();
  const cats = activeCats();
  if (!cats.length || !_stackData.length) {
    _g.append("text")
      .attr("class", "chart-empty-message")
      .attr("x", _width / 2)
      .attr("y", _height / 2)
      .text("No data for this selection");
    return;
  }

  let data = _stackData;
  if (_mode === "share") {
    data = _stackData.map((row) => {
      const total = d3.sum(cats, (c) => row[c] || 0);
      const nr = { period: row.period, _label: row._label };
      cats.forEach(
        (c) => (nr[c] = total > 0 ? ((row[c] || 0) / total) * 100 : 0),
      );
      return nr;
    });
  }

  const series = d3.stack().keys(cats).order(d3.stackOrderDescending)(data);

  _x = d3.scaleLinear().domain(d3.extent(_periods)).range([0, _width]);
  const yMax =
    _mode === "share"
      ? 100
      : d3.max(series, (s) => d3.max(s, (d) => d[1])) || 1;
  _y = d3
    .scaleLinear()
    .domain([0, yMax * 1.02])
    .range([_height, 0]);

  // Grid
  _y.ticks(5).forEach((t) => {
    _g.append("line")
      .attr("x1", 0)
      .attr("x2", _width)
      .attr("y1", _y(t))
      .attr("y2", _y(t))
      .attr("stroke", "#F0EEEB")
      .attr("stroke-width", 1);
  });

  // Axes
  const xTicks =
    _periods.length > 12 ? _periods.filter((_, i) => i % 2 === 0) : _periods;
  _g.append("g")
    .attr("transform", `translate(0,${_height})`)
    .call(
      d3
        .axisBottom(_x)
        .tickValues(xTicks)
        .tickFormat((p) => {
          const r = _stackData.find((d) => d.period === p);
          return r ? r._label : p;
        }),
    )
    .call((g) => {
      g.select(".domain").attr("stroke", "#D5D3D0");
      g.selectAll(".tick line").attr("stroke", "#D5D3D0");
      g.selectAll("text").attr("fill", "#5C5C5C").attr("font-size", "12px");
    });

  const yFmt = _mode === "share" ? (d) => d.toFixed(0) + "%" : fmtY;
  _g.append("g")
    .call(d3.axisLeft(_y).ticks(5).tickFormat(yFmt))
    .call((g) => {
      g.select(".domain").attr("stroke", "#D5D3D0");
      g.selectAll(".tick line").attr("stroke", "#D5D3D0");
      g.selectAll("text").attr("fill", "#5C5C5C").attr("font-size", "12px");
    });

  // Area layers
  const area = d3
    .area()
    .x((d) => _x(d.data.period))
    .y0((d) => _y(d[0]))
    .y1((d) => _y(d[1]))
    .curve(d3.curveMonotoneX);

  const layers = _g
    .selectAll(".sa-layer")
    .data(series)
    .enter()
    .append("path")
    .attr("class", "sa-layer")
    .attr("fill", (d) => `url(#grad-${d.key.replace(/\W/g, "")})`)
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5)
    .attr("opacity", 0.88)
    .attr("d", area)
    .style("cursor", "pointer")
    .attr("tabindex", 0)
    .on("mouseover", function (ev, d) {
      if (_lockedCat && _lockedCat !== d.key) return;
      highlight(d.key, layers);
      showTip(ev, d);
    })
    .on("mousemove", (ev, d) => showTip(ev, d))
    .on("mouseout", () => {
      if (!_lockedCat) {
        resetHL(layers);
        tooltip.hide();
      }
    })
    .on("click", (ev, d) => {
      if (_lockedCat === d.key) {
        _lockedCat = null;
        resetHL(layers);
      } else {
        _lockedCat = d.key;
        highlight(d.key, layers);
      }
    })
    .on("focus", function (ev, d) {
      highlight(d.key, layers);
    })
    .on("blur", () => {
      if (!_lockedCat) {
        resetHL(layers);
      }
    });

  if (animate)
    layers
      .attr("opacity", 0)
      .transition()
      .duration(TRANSITION_MS)
      .ease(d3.easeCubicInOut)
      .attr("opacity", 0.88);

  // Annotation
  drawAnnotation();
}

function highlight(key, layers) {
  layers
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .attr("opacity", (d) => (d.key === key ? 1 : 0.15));
}
function resetHL(layers) {
  layers
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .attr("opacity", 0.88);
}

function showTip(ev, d) {
  const [mx] = d3.pointer(ev, _g.node());
  const period = Math.round(_x.invert(mx));
  const row = _stackData.find((r) => r.period === period);
  if (!row) return;
  const val = row[d.key] || 0;
  const total = d3.sum(activeCats(), (c) => row[c] || 0);
  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
  tooltip.show(
    `<strong>${fmtMetric(d.key)}</strong><br>${row._label}: ${d3.format(",")(val)}<br>${pct}% of total`,
    ev,
  );
}

function drawAnnotation() {
  if (_categories.length < 3) return;
  const c2 = _categories[1],
    c3 = _categories[2];
  // Find first period where c2 overtakes c3 (but not from the very start)
  let prev2Below = false;
  let crossPeriod = null;
  for (const row of _stackData) {
    if ((row[c2] || 0) <= (row[c3] || 0)) prev2Below = true;
    if (prev2Below && (row[c2] || 0) > (row[c3] || 0)) {
      crossPeriod = row;
      break;
    }
  }
  if (!crossPeriod) return;

  const xPos = _x(crossPeriod.period);
  _g.append("line")
    .attr("x1", xPos)
    .attr("x2", xPos)
    .attr("y1", 0)
    .attr("y2", _height)
    .attr("stroke", "#5C5C5C")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3")
    .attr("opacity", 0.6);
  _g.append("text")
    .attr("x", xPos + 6)
    .attr("y", 16)
    .attr("fill", "#5C5C5C")
    .attr("font-size", "12px")
    .attr("font-weight", 500)
    .text(`${fmtMetric(c2)} overtakes`);
  _g.append("text")
    .attr("x", xPos + 6)
    .attr("y", 28)
    .attr("fill", "#5C5C5C")
    .attr("font-size", "12px")
    .attr("font-weight", 500)
    .text(fmtMetric(c3));
}

function drawLegend() {
  _container.selectAll(".chart-legend").remove();
  const lg = _container.append("div").attr("class", "chart-legend");
  _categories.forEach((c) => {
    const item = lg
      .append("span")
      .attr("class", "legend-item")
      .style("cursor", "pointer")
      .style("opacity", _hiddenCats.has(c) ? 0.35 : 1)
      .on("click", () => {
        if (_hiddenCats.has(c)) _hiddenCats.delete(c);
        else _hiddenCats.add(c);
        _lockedCat = null;
        render(true);
        drawLegend();
      });
    item
      .append("span")
      .attr("class", "legend-swatch")
      .style("background", _colorMap[c]);
    item.append("span").attr("class", "legend-label").text(fmtMetric(c));
  });
}

/* ── Small Multiples ── */
export function renderSmallMultiples(sel, finesData) {
  const smC = d3.select(sel);
  smC.html("");
  const jurisdictions = [
    ...new Set(finesData.map((d) => d.JURISDICTION).filter(Boolean)),
  ].sort();
  if (!jurisdictions.length) return;

  const overall = buildGrouped(finesData);
  const cats = overall.categories,
    cm = overall.colorMap,
    gp = overall.periods;
  const smH = 110,
    smW = 220;

  // Compute global y max for consistent small multiples
  const allSmData = [];
  for (const j of jurisdictions) {
    const jData = finesData.filter((d) => d.JURISDICTION === j);
    const grouped = buildGrouped(jData);
    const sd = gp.map((p) => {
      const ex = grouped.stackData.find((r) => r.period === p);
      const row = { period: p, _label: ex ? ex._label : String(p) };
      cats.forEach((c) => (row[c] = ex ? ex[c] || 0 : 0));
      return row;
    });
    allSmData.push({ j, sd });
  }
  const globalYMax =
    d3.max(allSmData, ({ sd }) => {
      const s = d3.stack().keys(cats).order(d3.stackOrderDescending)(sd);
      return d3.max(s, (ser) => d3.max(ser, (d) => d[1]));
    }) || 1;

  for (const { j, sd } of allSmData) {
    const card = smC
      .append("div")
      .attr("class", "small-chart")
      .style("cursor", "pointer")
      .attr("tabindex", 0)
      .on("click", () => {
        document.dispatchEvent(
          new CustomEvent("stacked-jurisdiction-filter", {
            detail: { jurisdiction: j },
          }),
        );
      })
      .on("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        document.dispatchEvent(
          new CustomEvent("stacked-jurisdiction-filter", {
            detail: { jurisdiction: j },
          }),
        );
      });
    card.append("div").attr("class", "small-chart-label").text(j.toUpperCase());

    const svg = card
      .append("svg")
      .attr("width", "100%")
      .attr("height", smH)
      .attr("viewBox", `0 0 ${smW} ${smH}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("role", "img")
      .attr(
        "aria-label",
        `Small multiple stacked area chart for ${j.toUpperCase()} fine composition`,
      );

    svg
      .append("title")
      .text(
        `Small multiple stacked area chart for ${j.toUpperCase()} fine composition`,
      );

    const x = d3
      .scaleLinear()
      .domain(d3.extent(gp))
      .range([4, smW - 4]);
    const series = d3.stack().keys(cats).order(d3.stackOrderDescending)(sd);
    const y = d3
      .scaleLinear()
      .domain([0, globalYMax])
      .range([smH - 4, 4]);

    const area = d3
      .area()
      .x((d) => x(d.data.period))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);
    series.forEach((s) => {
      svg
        .append("path")
        .datum(s)
        .attr("fill", cm[s.key])
        .attr("opacity", 0.8)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.3)
        .attr("d", area);
    });

    // Hover
    svg
      .append("rect")
      .attr("width", smW)
      .attr("height", smH)
      .attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev);
        const period = Math.round(x.invert(mx));
        const row = sd.find((r) => r.period === period);
        if (!row) return;
        const topCat = cats.reduce((a, b) =>
          (row[a] || 0) >= (row[b] || 0) ? a : b,
        );
        tooltip.show(
          `<strong>${j.toUpperCase()}</strong> &middot; ${row._label}<br>Top: ${fmtMetric(topCat)} (${d3.format(",")(row[topCat] || 0)})`,
          ev,
        );
      })
      .on("mouseout", () => tooltip.hide());
  }

  // Local jurisdiction filter listener
  const handler = (e) => {
    const { jurisdiction } = e.detail;
    const filtered = finesData.filter((d) => d.JURISDICTION === jurisdiction);
    const r = buildGrouped(filtered);
    _categories = r.categories;
    _colorMap = r.colorMap;
    _periods = r.periods;
    _stackData = r.stackData;
    _hiddenCats.clear();
    _lockedCat = null;
    render(true);
    drawLegend();
  };
  document.removeEventListener("stacked-jurisdiction-filter", handler);
  document.addEventListener("stacked-jurisdiction-filter", handler);
}

export function updateStackedArea(finesData, yearRange, states) {
  const nextStates = states && states.length > 0 ? [...states].sort() : [];
  const nextRange = yearRange ? [...yearRange] : [0, 9999];
  const nextState = { states: nextStates, yearRange: nextRange, mode: _mode };
  if (
    _lastFilterState &&
    sameArray(_lastFilterState.states, nextState.states) &&
    sameArray(_lastFilterState.yearRange, nextState.yearRange) &&
    _lastFilterState.mode === nextState.mode
  ) {
    return;
  }
  _lastFilterState = nextState;

  let filtered = finesData;
  if (states?.length)
    filtered = filtered.filter((d) => states.includes(d.JURISDICTION));
  if (yearRange)
    filtered = filtered.filter(
      (d) => d.YEAR >= yearRange[0] && d.YEAR <= yearRange[1],
    );
  const r = buildGrouped(filtered);
  _categories = r.categories;
  _colorMap = r.colorMap;
  _periods = r.periods;
  _stackData = r.stackData;
  _hiddenCats.clear();
  _lockedCat = null;
  render(true);
  drawLegend();
}

export function computeSection4Insight(finesData) {
  const g = buildGrouped(finesData);
  const { categories, stackData: sd, periods } = g;
  if (periods.length < 2 || !categories.length) return "";
  const first = sd[0],
    last = sd[sd.length - 1];
  let bestCat = "",
    bestGrowth = -Infinity,
    bestMult = 0;
  for (const c of categories) {
    const growth = (last[c] || 0) - (first[c] || 0);
    if (growth > bestGrowth) {
      bestGrowth = growth;
      bestCat = c;
      bestMult = (first[c] || 0) > 0 ? (last[c] || 0) / (first[c] || 0) : 0;
    }
  }
  if (!bestCat) return "";
  return `<strong>${fmtMetric(bestCat)}</strong> grew the fastest, increasing by <strong>${d3.format(",")(bestGrowth)}</strong> fines from ${first._label} to ${last._label} &mdash; a <strong>${bestMult.toFixed(1)}&times;</strong> growth multiple.`;
}
