/**
 * scatter.js
 * Scatter plot with clean log-scale ticks, horizontal legend, and polished dots.
 */
import { tooltip } from "../tooltip.js";

let _svg, _g, _container, _allData;
let _width, _height, _x, _y, _x0, _y0, _color, _zoom, _resetBtn;
let _activeStates = [];
let _activeYearRange = [0, 9999];
let _lastFilterState = null;
let _showHistory = false;
let _historyToggleBtn;
let _alcoholDrug, _breathTests, _drugTests;
let _metric = "alcohol";
const _margin = { top: 20, right: 20, bottom: 80, left: 58 };
const TRANSITION_MS = 400;

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function getPosTests(bt, j, yr) {
  const a = bt.find(
    (d) => d.JURISDICTION === j && d.YEAR === yr && d.AGE_GROUP === "all ages",
  );
  if (a && a.positive_breath_tests != null) return a.positive_breath_tests;
  const rows = bt.filter((d) => d.JURISDICTION === j && d.YEAR === yr);
  return rows.length ? d3.sum(rows, (d) => d.positive_breath_tests || 0) : null;
}

function getDrugPosTests(dt, j, yr) {
  const rows = dt.filter(
    (d) =>
      d.JURISDICTION === j &&
      d.YEAR === yr &&
      d.AGE_GROUP === "all ages" &&
      d.METRIC === "positive_drug_tests",
  );
  return rows.length ? d3.sum(rows, (d) => d.COUNT || 0) : null;
}

// Nice tick values for log scales
function logTicks(domain) {
  const lo = domain[0],
    hi = domain[1];
  const nice = [
    1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7,
  ];
  return nice.filter((v) => v >= lo * 0.9 && v <= hi * 1.1);
}
function fmtTick(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v;
}

function rebuildPointData() {
  const jurisdictions = [
    ...new Set(_alcoholDrug.map((d) => d.JURISDICTION).filter(Boolean)),
  ].sort();
  const years = [
    ...new Set(_alcoholDrug.map((d) => d.YEAR).filter((y) => y != null)),
  ].sort((a, b) => a - b);
  const maxYear = years[years.length - 1];
  _activeYearRange = [years[0], maxYear];

  _allData = [];
  for (const j of jurisdictions) {
    for (const yr of years) {
      const tRow = _alcoholDrug.find(
        (d) => d.JURISDICTION === j && d.YEAR === yr,
      );
      if (!tRow) continue;

      const tests =
        _metric === "drug"
          ? tRow.drug_test_conducted || 0
          : tRow.breath_test_conducted || 0;
      const posTotal =
        _metric === "drug"
          ? getDrugPosTests(_drugTests, j, yr)
          : getPosTests(_breathTests, j, yr);

      if (!tests || tests <= 0 || posTotal == null) continue;
      _allData.push({
        jurisdiction: j,
        year: yr,
        tests,
        rate: (posTotal / tests) * 100,
        isLatest: yr === maxYear,
      });
    }
  }

  _color = d3
    .scaleOrdinal()
    .domain(jurisdictions)
    .range([
      "#4E79A7",
      "#F28E2B",
      "#E15759",
      "#76B7B2",
      "#59A14F",
      "#EDC948",
      "#AF7AA1",
      "#FF9DA7",
    ]);
}

export function initScatter(
  selector,
  alcoholDrug,
  breathTests,
  drugTests,
  metric = "alcohol",
) {
  _container = d3.select(selector);
  _container.html("");
  _alcoholDrug = alcoholDrug;
  _breathTests = breathTests;
  _drugTests = drugTests;
  _metric = metric;

  rebuildPointData();

  const cw = _container.node().clientWidth || 520;
  _width = cw - _margin.left - _margin.right;
  _height = 300;

  const ctrlRow = _container.append("div").attr("class", "scatter-controls");
  _resetBtn = ctrlRow
    .append("button")
    .attr("class", "reset-zoom-btn")
    .text("Reset zoom")
    .style("display", "none")
    .on("click", () => {
      _svg
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .call(_zoom.transform, d3.zoomIdentity);
      _resetBtn.style("display", "none");
    });

  _historyToggleBtn = ctrlRow
    .append("button")
    .attr("type", "button")
    .attr("class", "scatter-toggle-btn")
    .attr("aria-pressed", "false")
    .text("Show history trails")
    .on("click", () => {
      _showHistory = !_showHistory;
      _historyToggleBtn
        .classed("active", _showHistory)
        .attr("aria-pressed", String(_showHistory))
        .text(_showHistory ? "Hide history trails" : "Show history trails");
      draw();
    });

  _svg = _container
    .append("svg")
    .attr("viewBox", `0 0 ${cw} ${_height + _margin.top + _margin.bottom}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr(
      "aria-label",
      "Scatter plot showing tests conducted versus positivity rate with regression line",
    )
    .style("width", "100%")
    .style("height", "auto");
  _svg
    .append("title")
    .text(
      "Scatter plot showing tests conducted versus positivity rate with regression line",
    );
  _svg
    .append("defs")
    .append("clipPath")
    .attr("id", "sc-clip")
    .append("rect")
    .attr("width", _width)
    .attr("height", _height);

  _g = _svg
    .append("g")
    .attr("transform", `translate(${_margin.left},${_margin.top})`);

  buildScales();
  draw();
  drawLegend();

  _zoom = d3.zoom().scaleExtent([0.5, 10]).on("zoom", zoomed);
  _svg.call(_zoom);
}

function vis() {
  return _allData.filter((d) => {
    const inState = _activeStates.length
      ? _activeStates.includes(d.jurisdiction)
      : true;
    const inYear =
      d.year >= _activeYearRange[0] && d.year <= _activeYearRange[1];
    return inState && inYear;
  });
}

function buildScales() {
  const tests = _allData.map((d) => d.tests).filter((t) => t > 0);
  const minT = d3.min(tests),
    maxT = d3.max(tests);

  // Always use log on x to reduce NT/remote-state outlier compression.
  _x = d3
    .scaleLog()
    .domain([Math.max(1, minT * 0.6), maxT * 1.5])
    .range([0, _width]);

  const rates = _allData.map((d) => d.rate);
  _y = d3
    .scaleLinear()
    .domain([0, d3.max(rates) * 1.15 || 1])
    .range([_height, 0])
    .nice();

  _x0 = _x.copy();
  _y0 = _y.copy();
}

function draw() {
  _g.selectAll("*").remove();

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
  const xTickVals = logTicks(_x.domain());
  const xAxisGen = d3.axisBottom(_x).tickFormat((d) => fmtTick(d));
  xAxisGen.tickValues(xTickVals);

  _g.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${_height})`)
    .call(xAxisGen)
    .call((g) =>
      g.selectAll("text").attr("fill", "#5C5C5C").attr("font-size", "12px"),
    )
    .call((g) => g.select(".domain").attr("stroke", "#D5D3D0"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "#D5D3D0"));

  _g.append("g")
    .attr("class", "y-axis")
    .call(
      d3
        .axisLeft(_y)
        .ticks(5)
        .tickFormat((d) => d.toFixed(1) + "%"),
    )
    .call((g) =>
      g.selectAll("text").attr("fill", "#5C5C5C").attr("font-size", "12px"),
    )
    .call((g) => g.select(".domain").attr("stroke", "#D5D3D0"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "#D5D3D0"));

  // Axis titles
  _g.append("text")
    .attr("x", _width / 2)
    .attr("y", _height + 38)
    .attr("text-anchor", "middle")
    .attr("fill", "#9A9A9A")
    .attr("font-size", "12px")
    .text("Tests conducted");
  _g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -_height / 2)
    .attr("y", -42)
    .attr("text-anchor", "middle")
    .attr("fill", "#9A9A9A")
    .attr("font-size", "12px")
    .text("Positivity rate (%)");

  // Content layer (clipped)
  const content = _g.append("g").attr("clip-path", "url(#sc-clip)");
  const visible = vis();

  if (!visible.length) {
    _g.append("text")
      .attr("class", "chart-empty-message")
      .attr("x", _width / 2)
      .attr("y", _height / 2)
      .text("No data for this selection");
    return;
  }

  const byJurisdiction = d3.group(visible, (d) => d.jurisdiction);
  const latestPoints = Array.from(byJurisdiction.values())
    .map((rows) =>
      rows
        .slice()
        .sort((a, b) => a.year - b.year)
        .at(-1),
    )
    .filter(Boolean);

  const historyPoints = _showHistory
    ? visible.filter(
        (d) =>
          !latestPoints.some(
            (l) => l.jurisdiction === d.jurisdiction && l.year === d.year,
          ),
      )
    : [];

  if (_showHistory) {
    byJurisdiction.forEach((rows, jurisdiction) => {
      const sorted = rows.slice().sort((a, b) => a.year - b.year);
      if (sorted.length < 2) return;
      content
        .append("path")
        .datum(sorted)
        .attr("fill", "none")
        .attr("stroke", _color(jurisdiction))
        .attr("stroke-width", 1)
        .attr("opacity", 0.25)
        .attr(
          "d",
          d3
            .line()
            .x((d) => _x(d.tests))
            .y((d) => _y(d.rate)),
        );
    });

    historyPoints.forEach((d) => {
      content
        .append("circle")
        .attr("cx", _x(d.tests))
        .attr("cy", _y(d.rate))
        .attr("r", 3)
        .attr("fill", _color(d.jurisdiction))
        .attr("opacity", 0.28);
    });
  }

  // Regression based on latest-year points only for clearer interpretation.
  if (latestPoints.length >= 2) {
    const n = latestPoints.length;
    const sx = d3.sum(latestPoints, (d) => d.tests),
      sy = d3.sum(latestPoints, (d) => d.rate);
    const sxy = d3.sum(latestPoints, (d) => d.tests * d.rate),
      sx2 = d3.sum(latestPoints, (d) => d.tests ** 2);
    const denom = n * sx2 - sx * sx;
    if (Math.abs(denom) > 1e-10) {
      const m = (n * sxy - sx * sy) / denom;
      const b = (sy - m * sx) / n;
      const yMean = sy / n;
      const ssTot = d3.sum(latestPoints, (d) => (d.rate - yMean) ** 2);
      const ssRes = d3.sum(
        latestPoints,
        (d) => (d.rate - (m * d.tests + b)) ** 2,
      );
      const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

      const xD = _x.domain();
      const pts = [];
      for (let i = 0; i <= 300; i++) {
        const xv = xD[0] + ((xD[1] - xD[0]) * i) / 300;
        const yv = m * xv + b;
        if (yv >= 0 && yv <= _y.domain()[1] * 1.5) pts.push({ x: xv, y: yv });
      }
      if (pts.length > 1) {
        content
          .append("path")
          .datum(pts)
          .attr("fill", "none")
          .attr("stroke", "#B0AEAB")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "6,5")
          .attr("opacity", 0.7)
          .attr(
            "d",
            d3
              .line()
              .x((d) => _x(d.x))
              .y((d) => _y(d.y)),
          );
      }
      _g.append("text")
        .attr("x", _width - 6)
        .attr("y", 14)
        .attr("text-anchor", "end")
        .attr("fill", "#5C5C5C")
        .attr("font-size", "12px")
        .attr("font-weight", 600)
        .text(`R\u00B2 (latest-year points) = ${r2.toFixed(2)}`);

      const strength =
        r2 < 0.2
          ? "very weak"
          : r2 < 0.4
            ? "weak"
            : r2 < 0.6
              ? "moderate"
              : "strong";
      const direction = m < 0 ? "negative" : m > 0 ? "positive" : "flat";
      const explanation =
        m < 0
          ? `${strength} ${direction} correlation.`
          : `${strength} ${direction} correlation.`;

      _g.append("text")
        .attr("x", _width - 6)
        .attr("y", 30)
        .attr("text-anchor", "end")
        .attr("fill", "#7A7874")
        .attr("font-size", "12px")
        .text(explanation);
    }
  }

  // Latest points are the primary marks.
  latestPoints.forEach((d) => {
    content
      .append("circle")
      .attr("class", "sc-dot")
      .attr("cx", _x(d.tests))
      .attr("cy", _y(d.rate))
      .attr("r", 7)
      .attr("fill", _color(d.jurisdiction))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("opacity", 0.95)
      .style("cursor", "pointer")
      .attr("tabindex", 0)
      .on("mouseover", function (ev) {
        d3.select(this)
          .transition()
          .duration(TRANSITION_MS)
          .ease(d3.easeCubicInOut)
          .attr("r", 11)
          .attr("stroke-width", 3);
        tooltip.show(
          `<strong>${d.jurisdiction.toUpperCase()}</strong> (${d.year}, latest in range)<br>Tests: ${d3.format(",")(d.tests)}<br>Positivity: ${d.rate.toFixed(2)}%`,
          ev,
        );
      })
      .on("mousemove", (ev) => tooltip.show(null, ev))
      .on("mouseout", function () {
        d3.select(this)
          .transition()
          .duration(TRANSITION_MS)
          .ease(d3.easeCubicInOut)
          .attr("r", 7)
          .attr("stroke-width", 2);
        tooltip.hide();
      })
      .on("focus", function () {
        d3.select(this)
          .transition()
          .duration(TRANSITION_MS)
          .ease(d3.easeCubicInOut)
          .attr("r", 11)
          .attr("stroke-width", 3);
      })
      .on("blur", function () {
        d3.select(this)
          .transition()
          .duration(TRANSITION_MS)
          .ease(d3.easeCubicInOut)
          .attr("r", 7)
          .attr("stroke-width", 2);
      });
  });

  // Labels (latest points only, conservative collision handling)
  const labelData = latestPoints;
  const labelPositions = labelData.map((d) => ({
    ...d,
    lx: _x(d.tests),
    ly: _y(d.rate),
  }));
  // Simple collision avoidance for labels
  labelPositions.sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labelPositions.length; i++) {
    if (labelPositions[i].ly - labelPositions[i - 1].ly < 14) {
      labelPositions[i].ly = labelPositions[i - 1].ly + 14;
    }
  }
  labelPositions.forEach((d) => {
    content
      .append("text")
      .attr("x", d.lx + 10)
      .attr("y", d.ly + 3)
      .attr("fill", "#777")
      .attr("font-size", "12px")
      .attr("font-weight", 500)
      .text(d.jurisdiction.toUpperCase());
  });
}

function drawLegend() {
  // Horizontal legend below chart
  _container.selectAll(".scatter-legend-row").remove();
  const lg = _container.append("div").attr("class", "scatter-legend-row");
  const jurisdictions = [...new Set(_allData.map((d) => d.jurisdiction))];
  jurisdictions.forEach((j) => {
    const item = lg
      .append("span")
      .style("display", "inline-flex")
      .style("align-items", "center")
      .style("gap", "5px")
      .style("margin-right", "14px");
    item
      .append("span")
      .style("width", "10px")
      .style("height", "10px")
      .style("border-radius", "50%")
      .style("background", _color(j))
      .style("display", "inline-block");
    item
      .append("span")
      .style("font-size", "12px")
      .style("font-weight", "500")
      .style("color", "#5C5C5C")
      .text(j.toUpperCase());
  });
}

function zoomed(event) {
  const t = event.transform;
  _x = t.rescaleX(_x0);
  _y = t.rescaleY(_y0);
  draw();
  _resetBtn.style(
    "display",
    t.k === 1 && t.x === 0 && t.y === 0 ? "none" : "inline-flex",
  );
}

export function updateScatter(
  alcoholDrug,
  breathTests,
  drugTests,
  yearRange,
  states,
  metric = "alcohol",
) {
  const nextStates = states && states.length > 0 ? [...states].sort() : [];
  const nextRange = yearRange ? [...yearRange] : [0, 9999];
  const nextState = { states: nextStates, yearRange: nextRange, metric };
  if (
    _lastFilterState &&
    sameArray(_lastFilterState.states, nextState.states) &&
    sameArray(_lastFilterState.yearRange, nextState.yearRange) &&
    _lastFilterState.metric === nextState.metric
  ) {
    return;
  }
  _lastFilterState = nextState;

  _alcoholDrug = alcoholDrug;
  _breathTests = breathTests;
  _drugTests = drugTests;
  _metric = metric;
  rebuildPointData();
  buildScales();

  _activeStates = states && states.length > 0 ? states : [];
  if (yearRange) {
    _activeYearRange = [...yearRange];
  }
  _x = _x0.copy();
  _y = _y0.copy();
  if (_svg && _zoom) _svg.call(_zoom.transform, d3.zoomIdentity);
  if (_resetBtn) _resetBtn.style("display", "none");
  draw();
}
