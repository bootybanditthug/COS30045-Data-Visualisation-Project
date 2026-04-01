/**
 * dualaxis.js
 * Dual-axis combo chart: bars for test volume, line for positivity rate.
 * Includes dynamic annotations and optional alcohol/drug toggle.
 */

import { tooltip } from "../tooltip.js";

// ─── Module state ───
let svg, chart, xScale, yLeft, yRight;
let gBars, gLine, gDots, gAnnotations, gXAxis, gYLeft, gYRight;
let containerEl;
let currentMode = "alcohol"; // 'alcohol' or 'drug'
let yearRange = [0, 9999];
let selectedStates = [];
let lastFilterState = null;
const TRANSITION_MS = 400;

function sameArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const margin = { top: 48, right: 60, bottom: 40, left: 64 };

// ─── Join data ───
function joinData(alcoholDrug, breathTests, states, yr, mode) {
  // For each year, aggregate
  const years = [
    ...new Set(alcoholDrug.map((d) => d.YEAR).filter((y) => y != null)),
  ].sort((a, b) => a - b);
  const filtered = years.filter((y) => y >= yr[0] && y <= yr[1]);

  return filtered.map((year) => {
    const adRows = alcoholDrug.filter(
      (d) =>
        d.YEAR === year &&
        (states.length === 0 || states.includes(d.JURISDICTION)),
    );
    const btRows = breathTests.filter(
      (d) =>
        d.YEAR === year &&
        d.AGE_GROUP === "all ages" &&
        (states.length === 0 || states.includes(d.JURISDICTION)),
    );

    const totalTests = d3.sum(adRows, (d) => d.breath_test_conducted || 0);
    const totalDrugTests = d3.sum(adRows, (d) => d.drug_test_conducted || 0);
    const totalPositive = d3.sum(btRows, (d) => d.positive_breath_tests || 0);
    const rate = totalTests > 0 ? (totalPositive / totalTests) * 100 : null;

    return {
      year,
      tests: mode === "drug" ? totalDrugTests : totalTests,
      rate,
      totalTests,
      totalDrugTests,
    };
  });
}

// ─── Find annotations ───
function findAnnotations(joined) {
  let peakIdx = -1;
  let peakIncrease = 0;
  for (let i = 1; i < joined.length; i++) {
    const diff = joined[i].tests - joined[i - 1].tests;
    if (diff > peakIncrease) {
      peakIncrease = diff;
      peakIdx = i;
    }
  }

  let lowestRateIdx = -1;
  let lowestRate = Infinity;
  joined.forEach((d, i) => {
    if (d.rate != null && d.rate < lowestRate) {
      lowestRate = d.rate;
      lowestRateIdx = i;
    }
  });

  const annotations = [];
  if (peakIdx >= 0) {
    annotations.push({
      year: joined[peakIdx].year,
      label: "Largest YoY increase in testing",
      position: "top",
    });
  }
  if (lowestRateIdx >= 0 && lowestRateIdx !== peakIdx) {
    annotations.push({
      year: joined[lowestRateIdx].year,
      label: "Lowest positivity on record",
      position: "bottom",
    });
  }
  return annotations;
}

// ─── Has drug toggle data? ───
function hasDrugData(alcoholDrug) {
  const withDrug = alcoholDrug.filter(
    (d) => d.drug_test_conducted != null && d.drug_test_conducted > 0,
  );
  const drugYears = new Set(withDrug.map((d) => d.YEAR));
  return drugYears.size > 3;
}

// ─── Init ───
export function initDualAxis(selector, alcoholDrug, breathTests) {
  containerEl = document.querySelector(selector);
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const years = alcoholDrug.map((d) => d.YEAR).filter((y) => y != null);
  yearRange = [Math.min(...years), Math.max(...years)];

  // Toggle button (if drug data exists)
  if (hasDrugData(alcoholDrug)) {
    const toggleWrap = document.createElement("div");
    toggleWrap.className = "dualaxis-toggle";
    toggleWrap.innerHTML = `
      <button class="toggle-btn active" data-mode="alcohol" aria-pressed="true" type="button">Alcohol</button>
      <button class="toggle-btn" data-mode="drug" aria-pressed="false" type="button">Drug</button>
    `;
    containerEl.appendChild(toggleWrap);

    toggleWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".toggle-btn");
      if (!btn) return;
      currentMode = btn.dataset.mode;
      toggleWrap
        .querySelectorAll(".toggle-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      toggleWrap
        .querySelectorAll(".toggle-btn")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderChart(alcoholDrug, breathTests);
    });
  }

  // SVG
  const width = (containerEl.clientWidth || 800) - margin.left - margin.right;
  const height = 380;

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
      "Dual-axis chart showing testing volume and positivity rate over time",
    )
    .attr("data-transition-ms", TRANSITION_MS);

  svg
    .append("title")
    .text(
      "Dual-axis chart showing testing volume and positivity rate over time",
    );

  chart = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Axis groups
  gXAxis = chart.append("g").attr("transform", `translate(0,${height})`);
  gYLeft = chart.append("g");
  gYRight = chart.append("g").attr("transform", `translate(${width},0)`);

  // Element groups (order matters for layering)
  gBars = chart.append("g");
  gLine = chart.append("g");
  gDots = chart.append("g");
  gAnnotations = chart.append("g");

  // Axis labels
  chart
    .append("text")
    .attr("class", "y-left-label")
    .attr("transform", "rotate(-90)")
    .attr("y", -50)
    .attr("x", -height / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("fill", "#1B6CC4")
    .text("Breath tests conducted");

  chart
    .append("text")
    .attr("class", "y-right-label")
    .attr("transform", "rotate(90)")
    .attr("y", -width - 48)
    .attr("x", height / 2)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("fill", "#E09420")
    .text("Positivity rate (%)");

  // Store dimensions
  svg.__dims = { width, height };

  // Render
  renderChart(alcoholDrug, breathTests);

  // Store refs for updates
  containerEl.__alcoholDrug = alcoholDrug;
  containerEl.__breathTests = breathTests;
}

function renderChart(alcoholDrug, breathTests) {
  const { width, height } = svg.__dims;
  const joined = joinData(
    alcoholDrug,
    breathTests,
    selectedStates,
    yearRange,
    currentMode,
  );

  if (joined.length === 0) {
    gAnnotations.selectAll("*").remove();
    gAnnotations
      .append("text")
      .attr("class", "chart-empty-message")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .text("No data for this selection");
    return;
  }

  // Scales
  xScale = d3
    .scaleBand()
    .domain(joined.map((d) => d.year))
    .range([0, width])
    .padding(0.3);

  yLeft = d3
    .scaleLinear()
    .domain([0, d3.max(joined, (d) => d.tests) || 1])
    .range([height, 0])
    .nice();

  const rateVals = joined.map((d) => d.rate).filter((r) => r != null);
  yRight = d3
    .scaleLinear()
    .domain([0, Math.max(d3.max(rateVals) || 2, 2)])
    .range([height, 0])
    .nice();

  // Axes
  gXAxis
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(
          joined
            .filter((_, i) => i % Math.ceil(joined.length / 12) === 0)
            .map((d) => d.year),
        ),
    )
    .call((g) => g.select(".domain").attr("stroke", "#E0DEDA"))
    .selectAll("text")
    .style("font-size", "12px")
    .style("fill", "#9A9A9A");

  gYLeft
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .call(d3.axisLeft(yLeft).ticks(6).tickFormat(d3.format(".2s")))
    .call((g) => g.select(".domain").remove())
    .call((g) =>
      g
        .selectAll(".tick line")
        .attr("stroke", "#E0DEDA")
        .attr("x2", width)
        .attr("opacity", 0.4),
    )
    .selectAll("text")
    .style("font-size", "12px")
    .style("fill", "#1B6CC4");

  gYRight
    .transition()
    .duration(TRANSITION_MS)
    .ease(d3.easeCubicInOut)
    .call(
      d3
        .axisRight(yRight)
        .ticks(5)
        .tickFormat((d) => d + "%"),
    )
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick line").remove())
    .selectAll("text")
    .style("font-size", "12px")
    .style("fill", "#E09420");

  // Update left label
  svg
    .select(".y-left-label")
    .text(
      currentMode === "drug"
        ? "Drug tests conducted"
        : "Breath tests conducted",
    );

  // ── Bars ──
  const bars = gBars.selectAll("rect").data(joined, (d) => d.year);

  bars.join(
    (enter) =>
      enter
        .append("rect")
        .attr("x", (d) => xScale(d.year))
        .attr("y", height)
        .attr("width", xScale.bandwidth())
        .attr("height", 0)
        .attr("rx", 4)
        .attr("fill", "#1B6CC4")
        .attr("opacity", 0.65)
        .attr("tabindex", 0)
        .style("outline", "none")
        .on("mouseover", function (event, d) {
          d3.select(this).attr("opacity", 1);
          tooltip.show(
            `<b>${d.year}</b><br>Tests: ${d3.format(",")(d.tests)}<br>Positivity: ${d.rate != null ? d3.format(".2f")(d.rate) + "%" : "N/A"}`,
            event,
          );
        })
        .on("mousemove", (event) => tooltip.show(null, event))
        .on("mouseout", function () {
          d3.select(this).attr("opacity", 0.65);
          tooltip.hide();
        })
        .on("focus", function () {
          d3.select(this).attr("opacity", 1);
        })
        .on("blur", function () {
          d3.select(this).attr("opacity", 0.65);
        })
        .call((enter) =>
          enter
            .transition()
            .duration(TRANSITION_MS)
            .ease(d3.easeCubicInOut)
            .attr("y", (d) => yLeft(d.tests))
            .attr("height", (d) => height - yLeft(d.tests)),
        ),
    (update) =>
      update
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("x", (d) => xScale(d.year))
        .attr("width", xScale.bandwidth())
        .attr("y", (d) => yLeft(d.tests))
        .attr("height", (d) => height - yLeft(d.tests)),
    (exit) =>
      exit
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("height", 0)
        .attr("y", height)
        .remove(),
  );

  // ── Line ──
  const lineData = joined.filter((d) => d.rate != null);
  const lineGen = d3
    .line()
    .x((d) => xScale(d.year) + xScale.bandwidth() / 2)
    .y((d) => yRight(d.rate))
    .curve(d3.curveMonotoneX);

  const linePath = gLine.selectAll("path").data([lineData]);
  linePath.join(
    (enter) =>
      enter
        .append("path")
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", "#E09420")
        .attr("stroke-width", 2.5)
        .attr("stroke-dasharray", "6,4"),
    (update) =>
      update
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("d", lineGen),
  );

  // ── Dots ──
  const dots = gDots.selectAll("circle").data(lineData, (d) => d.year);
  dots.join(
    (enter) =>
      enter
        .append("circle")
        .attr("cx", (d) => xScale(d.year) + xScale.bandwidth() / 2)
        .attr("cy", (d) => yRight(d.rate))
        .attr("r", 5)
        .attr("fill", "#E09420")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .attr("tabindex", 0)
        .style("outline", "none")
        .on("mouseover", function (event, d) {
          d3.select(this).attr("r", 7);
          tooltip.show(
            `<b>${d.year}</b><br>Positivity rate: ${d3.format(".2f")(d.rate)}%`,
            event,
          );
        })
        .on("mouseout", function () {
          d3.select(this).attr("r", 5);
          tooltip.hide();
        })
        .on("focus", function () {
          d3.select(this).attr("r", 7);
        })
        .on("blur", function () {
          d3.select(this).attr("r", 5);
        }),
    (update) =>
      update
        .transition()
        .duration(TRANSITION_MS)
        .ease(d3.easeCubicInOut)
        .attr("cx", (d) => xScale(d.year) + xScale.bandwidth() / 2)
        .attr("cy", (d) => yRight(d.rate)),
    (exit) => exit.remove(),
  );

  // ── Annotations ──
  gAnnotations.selectAll("*").remove();
  const annotations = findAnnotations(joined);

  annotations.forEach((ann) => {
    const xPos = xScale(ann.year) + xScale.bandwidth() / 2;
    const isTop = ann.position === "top";
    const yPos = isTop ? 10 : height - 10;

    // Dashed line
    gAnnotations
      .append("line")
      .attr("x1", xPos)
      .attr("x2", xPos)
      .attr("y1", 0)
      .attr("y2", height)
      .attr("stroke", "#9A9A9A")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 3")
      .attr("opacity", 0.5);

    // Label bg
    const labelG = gAnnotations
      .append("g")
      .attr("transform", `translate(${xPos},${yPos})`);

    const text = labelG
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", isTop ? 0 : -4)
      .style("font-size", "12px")
      .style("font-weight", "500")
      .style("fill", "#1A1A1A")
      .text(ann.label);

    // Measure text and add background
    const bbox = text.node().getBBox();
    labelG
      .insert("rect", "text")
      .attr("x", bbox.x - 8)
      .attr("y", bbox.y - 4)
      .attr("width", bbox.width + 16)
      .attr("height", bbox.height + 8)
      .attr("rx", 6)
      .attr("fill", "#fff")
      .attr("stroke", "#E0DEDA")
      .attr("stroke-width", 1);
  });
}

// ─── Update (from filter) ───
export function updateDualAxis(
  alcoholDrug,
  breathTests,
  newYearRange,
  newSelectedStates,
) {
  const nextRange = newYearRange || yearRange;
  const nextStates = (newSelectedStates || selectedStates || []).slice().sort();
  const nextState = {
    yearRange: [...nextRange],
    states: nextStates,
    mode: currentMode,
  };
  if (
    lastFilterState &&
    sameArray(lastFilterState.yearRange, nextState.yearRange) &&
    sameArray(lastFilterState.states, nextState.states) &&
    lastFilterState.mode === nextState.mode
  ) {
    return;
  }
  lastFilterState = nextState;

  if (newYearRange) yearRange = newYearRange;
  if (newSelectedStates != null) selectedStates = newSelectedStates;
  containerEl.__alcoholDrug = alcoholDrug;
  containerEl.__breathTests = breathTests;
  renderChart(alcoholDrug, breathTests);
}

// ─── Insight calculation ───
export function computeInsight(alcoholDrug, breathTests) {
  const joined = joinData(alcoholDrug, breathTests, [], [0, 9999], "alcohol");
  if (joined.length < 3) return "";

  // Correlation direction
  const withRate = joined.filter((d) => d.rate != null && d.tests > 0);
  if (withRate.length < 3) return "";

  const firstHalf = withRate.slice(0, Math.floor(withRate.length / 2));
  const secondHalf = withRate.slice(Math.floor(withRate.length / 2));
  const avgTestsFirst = d3.mean(firstHalf, (d) => d.tests);
  const avgTestsSecond = d3.mean(secondHalf, (d) => d.tests);
  const avgRateFirst = d3.mean(firstHalf, (d) => d.rate);
  const avgRateSecond = d3.mean(secondHalf, (d) => d.rate);

  const testsUp = avgTestsSecond > avgTestsFirst;
  const rateDown = avgRateSecond < avgRateFirst;

  let correlation = "";
  if (testsUp && rateDown) {
    correlation =
      "As testing volumes increased over the period, positivity rates generally declined — suggesting a possible deterrent effect.";
  } else if (testsUp && !rateDown) {
    correlation =
      "Despite increased testing volumes, positivity rates have not declined — raising questions about enforcement effectiveness.";
  } else {
    correlation =
      "Both testing volumes and positivity rates have shifted over the period.";
  }

  // Steepest drop in positivity
  let steepestDrop = 0;
  let dropStart = null;
  let dropEnd = null;
  for (let i = 1; i < withRate.length; i++) {
    const diff = withRate[i - 1].rate - withRate[i].rate;
    if (diff > steepestDrop) {
      steepestDrop = diff;
      dropStart = withRate[i - 1].year;
      dropEnd = withRate[i].year;
    }
  }

  let dropText = "";
  if (dropStart && steepestDrop > 0) {
    dropText = ` The steepest single-year decline in positivity (${d3.format(".2f")(steepestDrop)} percentage points) occurred between ${dropStart} and ${dropEnd}.`;
  }

  return correlation + dropText;
}
