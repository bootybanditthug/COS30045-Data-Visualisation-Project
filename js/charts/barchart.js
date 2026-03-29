/**
 * barchart.js
 * Stacked horizontal bar chart — breath + drug test volumes by jurisdiction.
 * Matches the reference: single stacked bar per state, total on right, legend below.
 */

import { tooltip } from "../tooltip.js";

// ─── Module state ───
let svg, chart, xScale, yScale, gBars, gXAxis, gYAxis, gLabels;
let containerEl;
const testColumns = ["breath_test_conducted", "drug_test_conducted"];
const typeColors = {
  breath_test_conducted: "#1B6CC4",
  drug_test_conducted: "#0F9E7B",
};
const typeLabels = {
  breath_test_conducted: "Alcohol (RBT)",
  drug_test_conducted: "Drugs (MDT)",
};

let currentData = [];
let yearRange = [0, 9999];
let highlightStates = [];
let animated = false;
let lastFilterState = null;
const TRANSITION_MS = 400;

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ─── Aggregate by jurisdiction, summing each test column ───
function aggregate(data, yr) {
  const map = new Map();
  for (const d of data) {
    if (d.YEAR < yr[0] || d.YEAR > yr[1]) continue;
    const j = d.JURISDICTION;
    if (!map.has(j)) {
      map.set(j, {
        jurisdiction: j,
        breath_test_conducted: 0,
        drug_test_conducted: 0,
      });
    }
    const entry = map.get(j);
    entry.breath_test_conducted += d.breath_test_conducted || 0;
    entry.drug_test_conducted += d.drug_test_conducted || 0;
  }
  return Array.from(map.values())
    .map((e) => ({
      ...e,
      total: e.breath_test_conducted + e.drug_test_conducted,
    }))
    .sort((a, b) => b.total - a.total);
}

// ─── Init ───
export function initBarChart(selector, data) {
  containerEl = document.querySelector(selector);
  if (!containerEl) return;
  containerEl.innerHTML = "";

  currentData = data;
  const years = data.map((d) => d.YEAR).filter((y) => y != null);
  yearRange = [Math.min(...years), Math.max(...years)];

  const agg = aggregate(data, yearRange);

  // ── Title ──
  const title = document.createElement("div");
  title.style.cssText =
    "font-size:16px;font-weight:600;color:#1A1A1A;margin-bottom:20px;";
  title.textContent = "Which states test the most?";
  containerEl.appendChild(title);

  // ── Layout ──
  const margin = { top: 4, right: 90, bottom: 8, left: 48 };
  const rowH = 48;
  const width = (containerEl.clientWidth || 440) - margin.left - margin.right;
  const height = agg.length * rowH;

  svg = d3
    .select(containerEl)
    .append("svg")
    .attr("width", "100%")
    .attr("height", height + margin.top + margin.bottom)
    .attr(
      "viewBox",
      `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`,
    )
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr(
      "aria-label",
      "Grouped bar chart showing breath tests and drug tests conducted per Australian jurisdiction",
    );

  svg
    .append("title")
    .text(
      "Grouped bar chart showing breath tests and drug tests conducted per Australian jurisdiction",
    );

  chart = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // ── Scales ──
  xScale = d3
    .scaleLinear()
    .domain([0, d3.max(agg, (d) => d.total) || 1])
    .range([0, width]);

  yScale = d3
    .scaleBand()
    .domain(agg.map((d) => d.jurisdiction))
    .range([0, height])
    .padding(0.35);

  // ── Y axis (state labels) ──
  gYAxis = chart
    .append("g")
    .call(d3.axisLeft(yScale).tickSize(0))
    .call((g) => g.select(".domain").remove());

  gYAxis
    .selectAll("text")
    .style("font-size", "12px")
    .style("font-weight", "600")
    .style("fill", "#1A1A1A")
    .style("text-transform", "uppercase");

  // ── Background track bars (light grey) ──
  chart
    .append("g")
    .selectAll("rect")
    .data(agg)
    .join("rect")
    .attr("x", 0)
    .attr("y", (d) => yScale(d.jurisdiction))
    .attr("width", width)
    .attr("height", yScale.bandwidth())
    .attr("rx", 4)
    .attr("fill", "#EEEDEA");

  // ── Stacked bars ──
  gBars = chart.append("g");

  // ── Total labels on right ──
  gLabels = chart.append("g");

  // Draw initial
  drawBars(agg, false);

  // ── Legend ──
  buildLegend(containerEl);

  // ── IntersectionObserver for entry animation ──
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !animated) {
          animated = true;
          drawBars(agg, true);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 },
  );

  observer.observe(containerEl);
}

// ─── Draw / redraw stacked bars ───
function drawBars(agg, animate) {
  gBars.selectAll("*").remove();
  gLabels.selectAll("*").remove();

  if (!agg.length) {
    const fallbackY = (yScale.range()[1] || 180) / 2;
    gBars
      .append("text")
      .attr("class", "chart-empty-message")
      .attr("x", xScale.range()[1] / 2)
      .attr("y", fallbackY)
      .text("No data for this selection");
    return;
  }

  agg.forEach((row, i) => {
    let xOffset = 0;

    testColumns.forEach((col) => {
      const val = row[col] || 0;
      const barW = xScale(val);

      gBars
        .append("rect")
        .attr("class", "stacked-bar")
        .attr("data-jurisdiction", row.jurisdiction)
        .attr("data-column", col)
        .attr("x", xOffset)
        .attr("y", yScale(row.jurisdiction))
        .attr("height", yScale.bandwidth())
        .attr("width", animate ? 0 : barW)
        .attr("rx", col === testColumns[testColumns.length - 1] ? 4 : 0)
        .attr("fill", typeColors[col])
        .attr("opacity", 0.9)
        .attr("tabindex", 0)
        .on("mouseover", function (event) {
          d3.select(this).attr("opacity", 1);
          tooltip.show(
            `<b>${row.jurisdiction.toUpperCase()}</b><br>${typeLabels[col]}: ${d3.format(",")(val)}`,
            event,
          );
        })
        .on("mousemove", (event) => tooltip.show(null, event))
        .on("mouseout", function () {
          applyHighlight();
          tooltip.hide();
        })
        .on("focus", function () {
          d3.select(this).attr("opacity", 1);
        })
        .on("blur", function () {
          applyHighlight();
        });

      if (animate) {
        gBars
          .select(
            `rect[data-jurisdiction="${row.jurisdiction}"][data-column="${col}"]`,
          )
          .transition()
          .delay(i * 60)
          .duration(TRANSITION_MS)
          .ease(d3.easeCubicInOut)
          .attr("width", barW);
      }

      xOffset += barW;
    });

    // Total label on the right
    const totalVal = row.total;
    const formatted =
      totalVal >= 1e6
        ? d3.format(".1f")(totalVal / 1e6) + "M Tests"
        : d3.format(".0f")(totalVal / 1e3) + "K Tests";

    gLabels
      .append("text")
      .attr("x", xScale(totalVal) + 8)
      .attr("y", yScale(row.jurisdiction) + yScale.bandwidth() / 2)
      .attr("dy", "0.35em")
      .style("font-size", "12px")
      .style("font-weight", "500")
      .style("fill", "#5C5C5C")
      .text(formatted)
      .attr("opacity", animate ? 0 : 1)
      .transition()
      .delay(animate ? i * 60 + 400 : 0)
      .duration(TRANSITION_MS)
      .ease(d3.easeCubicInOut)
      .attr("opacity", 1);
  });
}

function buildLegend(container) {
  const legendDiv = d3
    .select(container)
    .append("div")
    .style("display", "flex")
    .style("gap", "20px")
    .style("margin-top", "16px")
    .style("padding-left", "48px");

  testColumns.forEach((col) => {
    const item = legendDiv
      .append("div")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "6px");

    item
      .append("div")
      .style("width", "10px")
      .style("height", "10px")
      .style("border-radius", "50%")
      .style("background", typeColors[col]);

    item
      .append("span")
      .style("font-size", "12px")
      .style("color", "#5C5C5C")
      .style("font-weight", "500")
      .text(typeLabels[col]);
  });
}

function applyHighlight() {
  if (highlightStates.length === 0) {
    gBars.selectAll(".stacked-bar").attr("opacity", 0.9);
  } else {
    gBars.selectAll(".stacked-bar").each(function () {
      const bar = d3.select(this);
      const j = bar.attr("data-jurisdiction");
      bar.attr("opacity", highlightStates.includes(j) ? 1 : 0.2);
    });
  }
}

// ─── Update (from filter) ───
export function updateBarChart(filteredData, newYearRange, newHighlightStates) {
  const nextRange = newYearRange || yearRange;
  const nextStates = (newHighlightStates || highlightStates || [])
    .slice()
    .sort();
  const nextState = { yearRange: [...nextRange], states: nextStates };
  if (
    lastFilterState &&
    sameArray(lastFilterState.yearRange, nextState.yearRange) &&
    sameArray(lastFilterState.states, nextState.states)
  ) {
    return;
  }
  lastFilterState = nextState;

  if (newYearRange) yearRange = newYearRange;
  if (newHighlightStates != null) highlightStates = newHighlightStates;
  currentData = filteredData;

  const agg = aggregate(filteredData, yearRange);

  // Update scales
  xScale.domain([0, d3.max(agg, (d) => d.total) || 1]);
  yScale.domain(agg.map((d) => d.jurisdiction));

  // Update y-axis
  gYAxis
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .call(d3.axisLeft(yScale).tickSize(0))
    .call((g) => g.select(".domain").remove());

  gYAxis
    .selectAll("text")
    .style("font-size", "12px")
    .style("font-weight", "600")
    .style("fill", "#1A1A1A")
    .style("text-transform", "uppercase");

  // Redraw bars (no entry animation, just smooth update)
  drawBars(agg, false);
  applyHighlight();
}
