/**
 * slopechart.js
 * Slope chart with label collision resolution and polished visuals.
 */
import { tooltip } from "../tooltip.js";

let _svg, _g, _container, _alcoholDrug, _breathTests, _drugTests, _allYears;
let _width, _height;
const _margin = { top: 50, right: 150, bottom: 30, left: 150 };
let _yearA, _yearB, _selectA, _selectB;
let _activeStates = [];
let _lastFilterState = null;
let _metric = "alcohol";
const TRANSITION_MS = 400;
const STABLE_CHANGE_PP = 0.3;

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function getPositiveTests(breathTests, j, yr) {
  const a = breathTests.find(
    (d) => d.JURISDICTION === j && d.YEAR === yr && d.AGE_GROUP === "all ages",
  );
  if (a && a.positive_breath_tests != null) return a.positive_breath_tests;
  const rows = breathTests.filter((d) => d.JURISDICTION === j && d.YEAR === yr);
  return rows.length ? d3.sum(rows, (d) => d.positive_breath_tests || 0) : null;
}

function getPositiveDrugTests(drugTests, j, yr) {
  const rows = drugTests.filter(
    (d) =>
      d.JURISDICTION === j &&
      d.YEAR === yr &&
      d.AGE_GROUP === "all ages" &&
      d.METRIC === "positive_drug_tests",
  );
  return rows.length ? d3.sum(rows, (d) => d.COUNT || 0) : null;
}

function calcRate(ad, bt, dt, j, yr, metric) {
  const t = ad.find((d) => d.JURISDICTION === j && d.YEAR === yr);
  if (!t) return null;

  if (metric === "drug") {
    const p = getPositiveDrugTests(dt, j, yr);
    const tests = t.drug_test_conducted || 0;
    if (p == null || tests <= 0) return null;
    return (p / tests) * 100;
  }

  const p = getPositiveTests(bt, j, yr);
  const tests = t.breath_test_conducted || 0;
  if (p == null || tests <= 0) return null;
  return (p / tests) * 100;
}

// Push labels apart so they don't overlap
function resolveCollisions(labels, minGap) {
  labels.sort((a, b) => a.y - b.y);
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 1; i < labels.length; i++) {
      const gap = labels[i].y - labels[i - 1].y;
      if (gap < minGap) {
        const shift = (minGap - gap) / 2;
        labels[i - 1].y -= shift;
        labels[i].y += shift;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function initSlopeChart(
  selector,
  alcoholDrug,
  breathTests,
  drugTests,
  metric = "alcohol",
) {
  _alcoholDrug = alcoholDrug;
  _breathTests = breathTests;
  _drugTests = drugTests;
  _metric = metric;
  _container = d3.select(selector);
  _container.html("");

  _allYears = [
    ...new Set(alcoholDrug.map((d) => d.YEAR).filter((y) => y != null)),
  ].sort((a, b) => a - b);
  if (_allYears.length < 2) {
    _container.text("Insufficient data");
    return;
  }

  _yearA = _allYears[0];
  _yearB = _allYears[_allYears.length - 1];

  const ctrls = _container.append("div").attr("class", "slope-controls");
  ctrls.append("label").attr("class", "slope-label").text("Year A");
  _selectA = ctrls
    .append("select")
    .attr("id", "slope-year-a")
    .attr("class", "slope-select")
    .attr("aria-label", "Slope chart start year");
  _allYears.forEach((y) =>
    _selectA
      .append("option")
      .attr("value", y)
      .text(y)
      .property("selected", y === _yearA),
  );
  ctrls.append("span").attr("class", "slope-arrow").html("&#8594;");
  ctrls.append("label").attr("class", "slope-label").text("Year B");
  _selectB = ctrls
    .append("select")
    .attr("id", "slope-year-b")
    .attr("class", "slope-select")
    .attr("aria-label", "Slope chart end year");
  _allYears.forEach((y) =>
    _selectB
      .append("option")
      .attr("value", y)
      .text(y)
      .property("selected", y === _yearB),
  );

  _selectA.on("change", () => {
    _yearA = +_selectA.property("value");
    render(true);
  });
  _selectB.on("change", () => {
    _yearB = +_selectB.property("value");
    render(true);
  });

  const legend = _container.append("div").attr("class", "slope-legend");
  legend
    .append("span")
    .attr("class", "slope-legend-item")
    .html(
      '<span class="slope-legend-line slope-legend-line-down"></span>Improving (rate falling)',
    );
  legend
    .append("span")
    .attr("class", "slope-legend-item")
    .html(
      '<span class="slope-legend-line slope-legend-line-up"></span>Worsening (rate rising)',
    );
  legend
    .append("span")
    .attr("class", "slope-legend-item")
    .html(
      '<span class="slope-legend-line slope-legend-line-flat"></span>Stable',
    );

  const cw = _container.node().clientWidth || 520;
  _width = cw - _margin.left - _margin.right;
  _height = 360;

  const svgH = _height + _margin.top + _margin.bottom;
  _svg = _container
    .append("svg")
    .attr("viewBox", `0 0 ${cw} ${svgH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr(
      "aria-label",
      "Slope chart comparing positivity rates between two selected years by jurisdiction",
    )
    .style("width", "100%")
    .style("height", "auto");
  _svg
    .append("title")
    .text(
      "Slope chart comparing positivity rates between two selected years by jurisdiction",
    );
  _g = _svg
    .append("g")
    .attr("transform", `translate(${_margin.left},${_margin.top})`);
  render(false);
}

function render(animate) {
  _g.selectAll("*").remove();

  let jurisdictions = [
    ...new Set(_alcoholDrug.map((d) => d.JURISDICTION).filter(Boolean)),
  ];
  if (_activeStates.length > 0)
    jurisdictions = jurisdictions.filter((j) => _activeStates.includes(j));

  const items = [];
  for (const j of jurisdictions) {
    const rA = calcRate(
      _alcoholDrug,
      _breathTests,
      _drugTests,
      j,
      _yearA,
      _metric,
    );
    const rB = calcRate(
      _alcoholDrug,
      _breathTests,
      _drugTests,
      j,
      _yearB,
      _metric,
    );
    if (rA == null || rB == null) continue;
    items.push({ j, rA, rB, change: rB - rA });
  }

  if (!items.length) {
    _g.append("text")
      .attr("x", _width / 2)
      .attr("y", _height / 2)
      .attr("class", "chart-empty-message")
      .attr("text-anchor", "middle")
      .attr("fill", "#9A9A9A")
      .attr("font-size", "14px")
      .text("No data for this selection");
    return;
  }

  const allRates = items.flatMap((d) => [d.rA, d.rB]);
  const pad = (d3.max(allRates) - d3.min(allRates)) * 0.12 || 0.5;
  const yMin = Math.max(0, d3.min(allRates) - pad);
  const yMax = d3.max(allRates) + pad;
  const y = d3.scaleLinear().domain([yMax, yMin]).range([0, _height]);

  const xA = 0,
    xB = _width;

  // Subtle gradient background
  const grad = _svg.select("defs").size()
    ? _svg.select("defs")
    : _svg.append("defs");
  if (!grad.select("#slope-bg").size()) {
    const lg = grad
      .append("linearGradient")
      .attr("id", "slope-bg")
      .attr("x1", 0)
      .attr("x2", 1)
      .attr("y1", 0)
      .attr("y2", 0);
    lg.append("stop").attr("offset", "0%").attr("stop-color", "#F8F9FA");
    lg.append("stop").attr("offset", "50%").attr("stop-color", "#FFFFFF");
    lg.append("stop").attr("offset", "100%").attr("stop-color", "#F8F9FA");
  }
  _g.append("rect")
    .attr("x", -10)
    .attr("y", -10)
    .attr("width", _width + 20)
    .attr("height", _height + 20)
    .attr("rx", 8)
    .attr("fill", "url(#slope-bg)")
    .attr("opacity", 0.6);

  // Horizontal grid
  y.ticks(5).forEach((t) => {
    _g.append("line")
      .attr("x1", xA)
      .attr("x2", xB)
      .attr("y1", y(t))
      .attr("y2", y(t))
      .attr("stroke", "#E8E6E3")
      .attr("stroke-width", 0.5)
      .attr("stroke-dasharray", "3,3");
    _g.append("text")
      .attr("x", -8)
      .attr("y", y(t))
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#B0AEAB")
      .attr("font-size", "12px")
      .text(t.toFixed(1) + "%");
  });

  // Column axis lines
  _g.append("line")
    .attr("x1", xA)
    .attr("x2", xA)
    .attr("y1", -5)
    .attr("y2", _height + 5)
    .attr("stroke", "#D5D3D0")
    .attr("stroke-width", 1);
  _g.append("line")
    .attr("x1", xB)
    .attr("x2", xB)
    .attr("y1", -5)
    .attr("y2", _height + 5)
    .attr("stroke", "#D5D3D0")
    .attr("stroke-width", 1);

  // Column titles
  _g.append("text")
    .attr("x", xA)
    .attr("y", -22)
    .attr("text-anchor", "middle")
    .attr("fill", "#1A1A1A")
    .attr("font-size", "15px")
    .attr("font-weight", 700)
    .text(_yearA);
  _g.append("text")
    .attr("x", xB)
    .attr("y", -22)
    .attr("text-anchor", "middle")
    .attr("fill", "#1A1A1A")
    .attr("font-size", "15px")
    .attr("font-weight", 700)
    .text(_yearB);

  // Sort by biggest absolute change for emphasis
  const sorted = [...items].sort((a, b) => a.change - b.change);
  const topImp = sorted[0],
    topWor = sorted[sorted.length - 1];

  // Build label positions and resolve collisions
  const labelsL = items.map((d) => ({ j: d.j, y: y(d.rA), rate: d.rA }));
  const labelsR = items.map((d) => ({ j: d.j, y: y(d.rB), rate: d.rB }));
  resolveCollisions(labelsL, 18);
  resolveCollisions(labelsR, 18);

  // Draw each jurisdiction
  for (const d of items) {
    const yA = y(d.rA),
      yB = y(d.rB);
    const ch = d.change;

    let color;
    if (Math.abs(ch) < STABLE_CHANGE_PP) color = "#B0AEAB";
    else if (ch < 0) color = "#2E8B57";
    else color = "#C93B3B";

    const isImp =
      d.j === topImp.j && Math.abs(topImp.change) >= STABLE_CHANGE_PP;
    const isWor =
      d.j === topWor.j && Math.abs(topWor.change) >= STABLE_CHANGE_PP;
    const emphasis = isImp || isWor;
    const lw = emphasis ? 2.5 : 1.8;
    const opacity = emphasis ? 0.95 : 0.55;

    // Connecting line
    const line = _g
      .append("line")
      .attr("x1", xA)
      .attr("y1", yA)
      .attr("x2", animate ? xA : xB)
      .attr("y2", animate ? yA : yB)
      .attr("stroke", color)
      .attr("stroke-width", lw)
      .attr("opacity", opacity);
    if (Math.abs(ch) < STABLE_CHANGE_PP) line.attr("stroke-dasharray", "5,4");
    if (animate)
      line
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("x2", xB)
        .attr("y2", yB);

    // Hover
    _g.append("line")
      .attr("x1", xA)
      .attr("y1", yA)
      .attr("x2", xB)
      .attr("y2", yB)
      .attr("stroke", "transparent")
      .attr("stroke-width", 18)
      .style("cursor", "pointer")
      .attr("tabindex", 0)
      .on("mouseover", (ev) => {
        line.attr("stroke-width", 4).attr("opacity", 1);
        _g.selectAll(".slope-dot-" + d.j).attr("r", 7);
        const sign = ch >= 0 ? "+" : "";
        tooltip.show(
          `<strong>${d.j.toUpperCase()}</strong><br>${_yearA}: ${d.rA.toFixed(2)}% &rarr; ${_yearB}: ${d.rB.toFixed(2)}%<br>Change: ${sign}${ch.toFixed(2)}%`,
          ev,
        );
      })
      .on("mousemove", (ev) => tooltip.show(null, ev))
      .on("mouseout", () => {
        line.attr("stroke-width", lw).attr("opacity", opacity);
        _g.selectAll(".slope-dot-" + d.j).attr("r", 5);
        tooltip.hide();
      })
      .on("focus", () => {
        line.attr("stroke-width", 4).attr("opacity", 1);
        _g.selectAll(".slope-dot-" + d.j).attr("r", 7);
      })
      .on("blur", () => {
        line.attr("stroke-width", lw).attr("opacity", opacity);
        _g.selectAll(".slope-dot-" + d.j).attr("r", 5);
      });

    // Dots with white ring
    [
      { cx: xA, cy: yA },
      { cx: xB, cy: yB },
    ].forEach((p) => {
      _g.append("circle")
        .attr("class", "slope-dot-" + d.j)
        .attr("cx", p.cx)
        .attr("cy", p.cy)
        .attr("r", 5)
        .attr("fill", color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);
    });

    // Labels with collision-resolved Y
    const lL = labelsL.find((l) => l.j === d.j);
    const lR = labelsR.find((l) => l.j === d.j);
    const labelColor = color;
    const fw = emphasis ? 700 : 500;
    const fs = "12px";

    _g.append("text")
      .attr("x", xA - 14)
      .attr("y", lL.y)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", labelColor)
      .attr("font-size", fs)
      .attr("font-weight", fw)
      .text(`${d.j.toUpperCase()} ${d.rA.toFixed(2)}%`);

    // Connector from label to dot if label was pushed
    if (Math.abs(lL.y - yA) > 4) {
      _g.append("line")
        .attr("x1", xA - 12)
        .attr("y1", lL.y)
        .attr("x2", xA - 2)
        .attr("y2", yA)
        .attr("stroke", "#D5D3D0")
        .attr("stroke-width", 0.5);
    }

    _g.append("text")
      .attr("x", xB + 14)
      .attr("y", lR.y)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .attr("fill", labelColor)
      .attr("font-size", fs)
      .attr("font-weight", fw)
      .text(`${d.rB.toFixed(2)}% ${d.j.toUpperCase()}`);

    if (Math.abs(lR.y - yB) > 4) {
      _g.append("line")
        .attr("x1", xB + 12)
        .attr("y1", lR.y)
        .attr("x2", xB + 2)
        .attr("y2", yB)
        .attr("stroke", "#D5D3D0")
        .attr("stroke-width", 0.5);
    }
  }
}

export function updateSlopeChart(
  alcoholDrug,
  breathTests,
  drugTests,
  yearRange,
  states,
  metric = "alcohol",
) {
  const nextStates = states && states.length > 0 ? [...states].sort() : [];
  const nextRange = yearRange
    ? [...yearRange]
    : [_allYears[0], _allYears[_allYears.length - 1]];
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

  if (!_selectA || !_selectB) return;
  _metric = metric;
  _drugTests = drugTests;
  _activeStates = states && states.length > 0 ? states : [];
  if (yearRange) {
    const [lo, hi] = yearRange;
    const fy = _allYears.filter((y) => y >= lo && y <= hi);
    if (!fy.length) return;

    // Section slider is authoritative: keep dropdown endpoints locked to slider bounds.
    _yearA = fy[0];
    _yearB = fy[fy.length - 1];

    [_selectA, _selectB].forEach((sel, i) => {
      sel.selectAll("option").remove();
      fy.forEach((y) =>
        sel
          .append("option")
          .attr("value", y)
          .text(y)
          .property("selected", y === (i === 0 ? _yearA : _yearB)),
      );
    });
  }
  render(true);
}

export function computeSection3Insight(
  alcoholDrug,
  breathTests,
  drugTests,
  metric = "alcohol",
) {
  const years = [
    ...new Set(alcoholDrug.map((d) => d.YEAR).filter((y) => y != null)),
  ].sort((a, b) => a - b);
  if (years.length < 2) return "";
  const first = years[0],
    last = years[years.length - 1];
  const jurisdictions = [
    ...new Set(alcoholDrug.map((d) => d.JURISDICTION).filter(Boolean)),
  ];
  const changes = [];
  for (const j of jurisdictions) {
    const rF = calcRate(alcoholDrug, breathTests, drugTests, j, first, metric);
    const rL = calcRate(alcoholDrug, breathTests, drugTests, j, last, metric);
    if (rF == null || rL == null) continue;
    changes.push({ j, rF, rL, change: rL - rF });
  }
  if (changes.length < 2) return "";
  changes.sort((a, b) => a.change - b.change);
  const best = changes[0],
    worst = changes[changes.length - 1];
  const metricLabel =
    metric === "drug" ? "drug-test positivity" : "breath-test positivity";
  return `<strong>${best.j.toUpperCase()}</strong> showed the greatest improvement in ${metricLabel}, dropping from <strong>${best.rF.toFixed(2)}%</strong> to <strong>${best.rL.toFixed(2)}%</strong> (${first}&ndash;${last}). Meanwhile, <strong>${worst.j.toUpperCase()}</strong> saw the largest deterioration, rising from <strong>${worst.rF.toFixed(2)}%</strong> to <strong>${worst.rL.toFixed(2)}%</strong>.`;
}
