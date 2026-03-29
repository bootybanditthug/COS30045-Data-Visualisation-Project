/**
 * choropleth.js
 * Interactive choropleth map of Australia coloured by enforcement test volume.
 * Renders on a dark (#0D1B2A) card background with warm orange/yellow palette.
 */

import { tooltip } from "../tooltip.js";

// ─── State-name normalisation (GeoJSON → CSV) ───
const GEO_TO_CSV = {
  "new south wales": "nsw",
  victoria: "vic",
  queensland: "qld",
  "south australia": "sa",
  "western australia": "wa",
  tasmania: "tas",
  "northern territory": "nt",
  "australian capital territory": "act",
};

function normalise(geoName) {
  return GEO_TO_CSV[(geoName || "").toLowerCase().trim()] || null;
}

// ─── Module state ───
let svg, g, projection, pathGen, colorScale;
let features = [];
let currentData = [];
let selectedStates = new Set();
let yearRange = [0, 9999];
let lastFilterState = null;
const TRANSITION_MS = 400;

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function showNoDataMessage(show, width, height) {
  svg.selectAll(".chart-empty-message").remove();
  if (!show) return;
  svg
    .append("text")
    .attr("class", "chart-empty-message")
    .attr("x", width / 2)
    .attr("y", height / 2)
    .text("No data for this selection");
}

function aggregateByState(data, yr) {
  const map = new Map();
  for (const d of data) {
    if (d.YEAR < yr[0] || d.YEAR > yr[1]) continue;
    const j = d.JURISDICTION;
    if (!map.has(j)) map.set(j, 0);
    map.set(
      j,
      map.get(j) +
        (d.breath_test_conducted || 0) +
        (d.drug_test_conducted || 0),
    );
  }
  return map;
}

// ─── Init ───
export function initChoropleth(selector, geoJSON, csvData) {
  const container = document.querySelector(selector);
  if (!container) return;
  container.innerHTML = "";

  // Log GeoJSON properties
  const sample = geoJSON.features[0]?.properties;
  console.log("GeoJSON property keys:", sample ? Object.keys(sample) : "none");

  features = geoJSON.features;
  features.forEach((f) => {
    const geoName = f.properties.STATE_NAME || f.properties.name || "";
    f._jurisdiction = normalise(geoName);
    if (!f._jurisdiction) {
      console.warn("No CSV match for GeoJSON feature:", geoName);
    }
  });

  currentData = csvData;
  const years = csvData.map((d) => d.YEAR).filter((y) => y != null);
  yearRange = [Math.min(...years), Math.max(...years)];

  // ── Dimensions — fill the container ──
  const width = container.clientWidth || 560;
  const height = container.clientHeight || 420;

  svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr(
      "aria-label",
      "Choropleth map showing road safety tests conducted across Australian jurisdictions",
    )
    .style("display", "block");

  svg
    .append("title")
    .text(
      "Choropleth map showing road safety tests conducted across Australian jurisdictions",
    );

  g = svg.append("g");

  // ── Projection — fit Australia with generous padding ──
  projection = d3.geoMercator();
  const pad = 20;
  projection.fitExtent(
    [
      [pad, pad],
      [width - pad, height - pad - 36],
    ],
    geoJSON,
  );
  pathGen = d3.geoPath().projection(projection);

  // ── Colour scale: warm orange/amber on dark background ──
  const stateMap = aggregateByState(csvData, yearRange);
  const maxVal = Math.max(1, d3.max(Array.from(stateMap.values())));
  colorScale = d3.scaleSequential(d3.interpolateYlOrBr).domain([0, maxVal]);

  // ── Draw state paths ──
  g.selectAll("path.state")
    .data(features)
    .join("path")
    .attr("class", "state")
    .attr("d", pathGen)
    .attr("fill", (d) => {
      const val = stateMap.get(d._jurisdiction) || 0;
      return val > 0 ? colorScale(val) : "#1A2E42";
    })
    .attr("stroke", "rgba(255,255,255,0.25)")
    .attr("stroke-width", 0.5)
    .attr("tabindex", 0)
    .style("cursor", "pointer")
    .on("mouseenter", function (event, d) {
      const stMap = aggregateByState(currentData, yearRange);
      const val = stMap.get(d._jurisdiction) || 0;
      const name =
        d.properties.STATE_NAME || d._jurisdiction?.toUpperCase() || "Unknown";

      // Highlight stroke
      d3.select(this)
        .raise()
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("stroke", "#E09420")
        .attr("stroke-width", 2.5);

      tooltip.show(
        `<b style="font-size:13px">${name}</b><br>
         <span style="color:#5C5C5C">Tests:</span> <b>${d3.format(",")(val)}</b><br>
         <span style="color:#9A9A9A;font-size:12px">${yearRange[0]}\u2013${yearRange[1]}</span>`,
        event,
      );
    })
    .on("mousemove", function (event) {
      tooltip.show(null, event);
    })
    .on("mouseleave", function (event, d) {
      const isSelected = selectedStates.has(d._jurisdiction);
      d3.select(this)
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("stroke", isSelected ? "#1B6CC4" : "rgba(255,255,255,0.25)")
        .attr("stroke-width", isSelected ? 2.5 : 0.5);
      tooltip.hide();
    })
    .on("click", function (event, d) {
      if (!d._jurisdiction) return;
      if (selectedStates.has(d._jurisdiction)) {
        selectedStates.delete(d._jurisdiction);
      } else {
        selectedStates.add(d._jurisdiction);
      }
      applySelectionStrokes();
      emitMapFilterChange();
    })
    .on("keydown", function (event, d) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!d._jurisdiction) return;
      if (selectedStates.has(d._jurisdiction)) {
        selectedStates.delete(d._jurisdiction);
      } else {
        selectedStates.add(d._jurisdiction);
      }
      applySelectionStrokes();
      emitMapFilterChange();
    });

  // ── Legend bar ──
  buildLegend(svg, width, height, maxVal);

  // ── Resize observer ──
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 100 || h < 100) return;
      svg.attr("width", w).attr("height", h);
      projection.fitExtent(
        [
          [pad, pad],
          [w - pad, h - pad - 36],
        ],
        geoJSON,
      );
      g.selectAll("path.state").attr("d", pathGen);
      // Reposition legend
      svg
        .select(".legend-group")
        .attr("transform", `translate(${(w - 200) / 2}, ${h - 28})`);
    });
    ro.observe(container);
  }
}

function applySelectionStrokes() {
  g.selectAll("path.state")
    .attr("stroke", (d) =>
      selectedStates.has(d._jurisdiction)
        ? "#1B6CC4"
        : "rgba(255,255,255,0.25)",
    )
    .attr("stroke-width", (d) =>
      selectedStates.has(d._jurisdiction) ? 2.5 : 0.5,
    );
}

function emitMapFilterChange() {
  document.dispatchEvent(
    new CustomEvent("filterchange", {
      detail: {
        source: "map",
        sectionId: "section-01",
        states: [...selectedStates],
        yearRange: [...yearRange],
      },
    }),
  );
}

function buildLegend(svg, width, height, maxVal) {
  const lw = 200;
  const lh = 8;
  const lg = svg
    .append("g")
    .attr("class", "legend-group")
    .attr("transform", `translate(${(width - lw) / 2}, ${height - 28})`);

  // Title
  lg.append("text")
    .attr("x", lw / 2)
    .attr("y", -6)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("fill", "rgba(255,255,255,0.45)")
    .style("font-family", "'Inter', sans-serif")
    .text("Tests conducted");

  // Gradient bar
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "choro-grad");
  const stops = [0, 0.25, 0.5, 0.75, 1];
  stops.forEach((t) => {
    grad
      .append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", d3.interpolateYlOrBr(t));
  });

  lg.append("rect")
    .attr("width", lw)
    .attr("height", lh)
    .attr("rx", 4)
    .style("fill", "url(#choro-grad)");

  // Labels
  lg.append("text")
    .attr("x", 0)
    .attr("y", lh + 12)
    .attr("text-anchor", "start")
    .style("font-size", "12px")
    .style("fill", "rgba(255,255,255,0.4)")
    .style("font-family", "'Inter', sans-serif")
    .text("Low");

  lg.append("text")
    .attr("x", lw)
    .attr("y", lh + 12)
    .attr("text-anchor", "end")
    .style("font-size", "12px")
    .style("fill", "rgba(255,255,255,0.4)")
    .style("font-family", "'Inter', sans-serif")
    .text("High");
}

// ─── Update ───
export function updateChoropleth(
  filteredData,
  newYearRange,
  newSelectedStates,
) {
  const nextRange = newYearRange || yearRange;
  const nextStates = (
    newSelectedStates != null ? [...newSelectedStates] : [...selectedStates]
  ).sort();
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
  if (newSelectedStates != null) selectedStates = new Set(newSelectedStates);
  currentData = filteredData;

  const stateMap = aggregateByState(filteredData, yearRange);
  const maxVal = Math.max(1, d3.max(Array.from(stateMap.values())));
  colorScale.domain([0, maxVal]);

  g.selectAll("path.state")
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .attr("fill", (d) => {
      const val = stateMap.get(d._jurisdiction) || 0;
      return val > 0 ? colorScale(val) : "#1A2E42";
    });

  applySelectionStrokes();

  const dims = svg.node().getBoundingClientRect();
  const hasData = Array.from(stateMap.values()).some((v) => (v || 0) > 0);
  showNoDataMessage(!hasData, dims.width || 560, dims.height || 420);
}
