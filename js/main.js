/**
 * main.js
 * Entry point — loads data, calculates KPIs, builds filter bars,
 * manages navigation state, and dispatches filter events.
 */

import { loadAllData } from "./dataloader.js";
import { initChoropleth, updateChoropleth } from "./charts/choropleth.js";
import { initBarChart, updateBarChart } from "./charts/barchart.js";
import {
  initDualAxis,
  updateDualAxis,
  computeInsight as computeDualAxisInsight,
} from "./charts/dualaxis.js";
import {
  initSlopeChart,
  updateSlopeChart,
  computeSection3Insight,
} from "./charts/slopechart.js";
import { initScatter, updateScatter } from "./charts/scatter.js";
import {
  initStackedArea,
  updateStackedArea,
  renderSmallMultiples,
  computeSection4Insight,
} from "./charts/stackedarea.js";

// ─── DOM references ───
const overlay = document.getElementById("loading-overlay");
const errorBox = document.getElementById("error-message");
const nav = document.getElementById("main-nav");
const TRANSITION_MS = 400;

// ─── Scroll → nav .scrolled ───
function setupNavScroll() {
  const hero = document.getElementById("hero");
  if (!hero) return;
  const threshold = hero.offsetHeight * 0.3;

  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY > threshold) {
        nav.classList.add("scrolled");
      } else {
        nav.classList.remove("scrolled");
      }
    },
    { passive: true },
  );
}

// ─── IntersectionObserver for active nav link ───
function setupNavHighlight() {
  const sections = document.querySelectorAll('section[id^="section-"]');
  const navLinks = document.querySelectorAll("#main-nav .nav-center .nav-link");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach((link) => {
            const href = link.getAttribute("href");
            if (href === `#${id}`) {
              link.classList.add("active");
            } else {
              link.classList.remove("active");
            }
          });
        }
      });
    },
    {
      rootMargin: "-30% 0px -60% 0px",
      threshold: 0,
    },
  );

  sections.forEach((sec) => observer.observe(sec));
}

// ─── Mobile nav toggle ───
function setupMobileNav() {
  const toggle = document.getElementById("nav-mobile-toggle");
  const overlay = document.getElementById("nav-mobile-overlay");
  if (!toggle || !overlay) return;

  function closeMenu() {
    overlay.classList.remove("active");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
  }

  function openMenu() {
    overlay.classList.add("active");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation menu");
  }

  toggle.addEventListener("click", () => {
    if (overlay.classList.contains("active")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  overlay.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      closeMenu();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!overlay.classList.contains("active")) return;
    if (overlay.contains(event.target) || toggle.contains(event.target)) return;
    closeMenu();
  });
}

// ─── KPI Calculations ───
function populateKPIs(data) {
  const { alcoholDrug, breathTests, fines } = data;

  // Derive year range
  const allYears = alcoholDrug.map((d) => d.YEAR).filter((y) => y != null);
  const minYear = Math.min(...allYears);
  const maxYear = Math.max(...allYears);
  const yearSpan = maxYear - minYear;

  // Unique jurisdictions
  const jurisdictions = [
    ...new Set(alcoholDrug.map((d) => d.JURISDICTION).filter(Boolean)),
  ];
  const numJurisdictions = jurisdictions.length;

  // Update nav year range
  const navYearEl = document.getElementById("nav-year-range");
  if (navYearEl) {
    navYearEl.textContent = `${minYear}\u2013${maxYear} \u00B7 BITRE`;
  }

  // Update hero subtitle dynamically
  const subtitleEl = document.getElementById("hero-subtitle");
  if (subtitleEl) {
    subtitleEl.textContent = `An analysis of ${yearSpan} years of enforcement data across ${numJurisdictions} Australian jurisdictions, from ${minYear} to ${maxYear}.`;
  }

  // ── KPI 1: Total breath tests in most recent year ──
  const latestYearRows = alcoholDrug.filter((d) => d.YEAR === maxYear);
  const prevYearRows = alcoholDrug.filter((d) => d.YEAR === maxYear - 1);

  const totalBreathLatest = d3.sum(
    latestYearRows,
    (d) => d.breath_test_conducted || 0,
  );
  const totalBreathPrev = d3.sum(
    prevYearRows,
    (d) => d.breath_test_conducted || 0,
  );

  setKPI(
    1,
    `Breath tests (${maxYear})`,
    d3.format(".2s")(totalBreathLatest),
    calcTrend(totalBreathLatest, totalBreathPrev, "vs " + (maxYear - 1)),
  );

  // ── KPI 2: Avg positivity rate in most recent year ──
  // positive_breath_tests / breath_test_conducted per jurisdiction, then average
  const latestBreathPos = breathTests.filter(
    (d) => d.YEAR === maxYear && d.AGE_GROUP === "all ages",
  );
  const firstYearBreathPos = breathTests.filter(
    (d) => d.YEAR === minYear && d.AGE_GROUP === "all ages",
  );

  // Build per-jurisdiction rates for latest year
  const latestRates = [];
  for (const row of latestBreathPos) {
    const j = row.JURISDICTION;
    const testRow = latestYearRows.find((t) => t.JURISDICTION === j);
    if (
      testRow &&
      testRow.breath_test_conducted > 0 &&
      row.positive_breath_tests != null
    ) {
      latestRates.push(
        (row.positive_breath_tests / testRow.breath_test_conducted) * 100,
      );
    }
  }

  // Build per-jurisdiction rates for first year
  const firstYearAlcohol = alcoholDrug.filter((d) => d.YEAR === minYear);
  const firstRates = [];
  for (const row of firstYearBreathPos) {
    const j = row.JURISDICTION;
    const testRow = firstYearAlcohol.find((t) => t.JURISDICTION === j);
    if (
      testRow &&
      testRow.breath_test_conducted > 0 &&
      row.positive_breath_tests != null
    ) {
      firstRates.push(
        (row.positive_breath_tests / testRow.breath_test_conducted) * 100,
      );
    }
  }

  const avgRateLatest = latestRates.length > 0 ? d3.mean(latestRates) : 0;
  const avgRateFirst = firstRates.length > 0 ? d3.mean(firstRates) : 0;

  const rateDiff = avgRateLatest - avgRateFirst;
  const rateDirection =
    rateDiff < 0 ? "improving" : rateDiff > 0 ? "worsening" : "stable";
  const rateTrendClass =
    rateDiff < 0 ? "positive" : rateDiff > 0 ? "negative" : "neutral";

  setKPI(2, "Avg positivity rate", d3.format(".2f")(avgRateLatest) + " %", {
    text: `${rateDiff < 0 ? "\u2193" : "\u2191"} ${rateDirection} since ${minYear}`,
    cls: rateTrendClass,
  });

  // ── KPI 3: Total drug tests in most recent year ──
  const totalDrugLatest = d3.sum(
    latestYearRows,
    (d) => d.drug_test_conducted || 0,
  );
  const totalDrugPrev = d3.sum(prevYearRows, (d) => d.drug_test_conducted || 0);

  if (totalDrugLatest > 0) {
    setKPI(
      3,
      `Drug tests (${maxYear})`,
      d3.format(".2s")(totalDrugLatest),
      calcTrend(totalDrugLatest, totalDrugPrev, "vs " + (maxYear - 1)),
    );
  } else {
    // Fallback: total tests across all jurisdictions
    const totalAll = totalBreathLatest + totalDrugLatest;
    setKPI(3, `Total tests (${maxYear})`, d3.format(".2s")(totalAll), {
      text: "all jurisdictions",
      cls: "neutral",
    });
  }

  // ── KPI 4: Sum of all fines across all years ──
  const finesYears = fines.map((d) => d.YEAR).filter((y) => y != null);
  const finesMinYear = finesYears.length ? Math.min(...finesYears) : minYear;
  const finesMaxYear = finesYears.length ? Math.max(...finesYears) : maxYear;
  const totalFines = d3.sum(fines, (d) => d.FINES || 0);

  setKPI(4, "Total fines recorded", d3.format(".2s")(totalFines), {
    text: `${finesMinYear}\u2013${finesMaxYear}`,
    cls: "neutral",
  });
}

function setKPI(n, label, value, trend) {
  const labelEl = document.getElementById(`kpi-${n}-label`);
  const valueEl = document.getElementById(`kpi-${n}-value`);
  const trendEl = document.getElementById(`kpi-${n}-trend`);

  if (labelEl) labelEl.textContent = label;
  if (valueEl) valueEl.textContent = value;
  if (trendEl) {
    if (typeof trend === "string") {
      trendEl.textContent = trend;
    } else if (trend && trend.text) {
      trendEl.textContent = trend.text;
      trendEl.className = "kpi-trend";
      if (trend.cls === "negative") trendEl.classList.add("negative");
      if (trend.cls === "neutral") trendEl.classList.add("neutral");
    }
  }
}

function calcTrend(current, previous, suffix) {
  if (!previous || previous === 0) {
    return { text: suffix, cls: "neutral" };
  }
  const pctChange = ((current - previous) / previous) * 100;
  const arrow = pctChange >= 0 ? "\u2191" : "\u2193";
  const sign = pctChange >= 0 ? "+" : "";
  return {
    text: `${arrow} ${sign}${d3.format(".1f")(pctChange)}% ${suffix}`,
    cls: pctChange >= 0 ? "positive" : "negative",
  };
}

// ─── Filter Bar Builder ───
function buildFilterBar(sectionId, dataset) {
  const container = document.getElementById(`${sectionId}-filters`);
  if (!container) return;

  // Clear existing
  container.innerHTML = "";

  // Derive jurisdictions
  const jurisdictions = Array.from(
    new Set(dataset.map((d) => d.JURISDICTION).filter(Boolean)),
  ).sort();

  // Derive year range
  const years = dataset
    .map((d) => d.YEAR)
    .filter((y) => y != null && !isNaN(y));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  // ── Left: jurisdiction pills ──
  const pillsDiv = document.createElement("div");
  pillsDiv.className = "filter-pills";

  // "All" pill
  const allPill = document.createElement("button");
  allPill.className = "filter-pill active";
  allPill.textContent = "All";
  allPill.dataset.jurisdiction = "__all__";
  pillsDiv.appendChild(allPill);

  // Jurisdiction pills
  jurisdictions.forEach((j) => {
    const pill = document.createElement("button");
    pill.className = "filter-pill";
    pill.textContent = j.toUpperCase();
    pill.dataset.jurisdiction = j;
    pillsDiv.appendChild(pill);
  });

  container.appendChild(pillsDiv);

  // ── Right: year range ──
  const yearDiv = document.createElement("div");
  yearDiv.className = "filter-year-range";

  const yearLabel = document.createElement("span");
  yearLabel.className = "filter-year-label";
  yearLabel.textContent = `${minYear} \u2192 ${maxYear}`;

  const sliderGroup = document.createElement("div");
  sliderGroup.className = "year-slider-group";

  const sliderMin = document.createElement("input");
  sliderMin.type = "range";
  sliderMin.min = minYear;
  sliderMin.max = maxYear;
  sliderMin.value = minYear;
  sliderMin.setAttribute("aria-label", "Start year");

  const sliderMax = document.createElement("input");
  sliderMax.type = "range";
  sliderMax.min = minYear;
  sliderMax.max = maxYear;
  sliderMax.value = maxYear;
  sliderMax.setAttribute("aria-label", "End year");

  sliderGroup.appendChild(sliderMin);
  sliderGroup.appendChild(sliderMax);

  const clearBtn = document.createElement("button");
  clearBtn.className = "filter-pill";
  clearBtn.type = "button";
  clearBtn.textContent = "Clear";

  yearDiv.appendChild(sliderGroup);
  yearDiv.appendChild(yearLabel);
  yearDiv.appendChild(clearBtn);
  container.appendChild(yearDiv);

  // ── State ──
  let activeStates = []; // empty = All
  let startYear = minYear;
  let endYear = maxYear;

  function dispatchFilterChange(source = "section") {
    document.dispatchEvent(
      new CustomEvent("filterchange", {
        detail: {
          source,
          sectionId,
          states: [...activeStates],
          yearRange: [startYear, endYear],
          transitionMs: TRANSITION_MS,
        },
      }),
    );
  }

  function syncPillUI() {
    allPills.forEach((p) => p.classList.remove("active"));
    if (activeStates.length === 0) {
      allPill.classList.add("active");
      return;
    }
    allPills.forEach((p) => {
      const j = p.dataset.jurisdiction;
      if (j !== "__all__" && activeStates.includes(j)) {
        p.classList.add("active");
      }
    });
  }

  function applyState(nextStates, nextRange, source = "section", emit = true) {
    activeStates = [...new Set((nextStates || []).filter(Boolean))];
    if (nextRange) {
      startYear = Math.max(minYear, Math.min(maxYear, +nextRange[0]));
      endYear = Math.max(minYear, Math.min(maxYear, +nextRange[1]));
      if (startYear > endYear) {
        const t = startYear;
        startYear = endYear;
        endYear = t;
      }
      sliderMin.value = startYear;
      sliderMax.value = endYear;
    }
    updateYearLabel();
    syncPillUI();
    if (emit) {
      dispatchFilterChange(source);
    }
  }

  // ── Pill click handling ──
  const allPills = pillsDiv.querySelectorAll(".filter-pill");

  pillsDiv.addEventListener("click", (e) => {
    const pill = e.target.closest(".filter-pill");
    if (!pill) return;

    const j = pill.dataset.jurisdiction;

    if (j === "__all__") {
      // Activate "All", deactivate everything else
      activeStates = [];
      syncPillUI();
    } else {
      // Toggle this jurisdiction
      // Deactivate "All"
      allPill.classList.remove("active");

      if (pill.classList.contains("active")) {
        pill.classList.remove("active");
        activeStates = activeStates.filter((s) => s !== j);
      } else {
        pill.classList.add("active");
        activeStates.push(j);
      }

      // If nothing is active, re-activate "All"
      if (activeStates.length === 0) syncPillUI();
    }

    dispatchFilterChange("section");
  });

  // ── Slider handling ──
  function updateYearLabel() {
    yearLabel.textContent = `${startYear} \u2192 ${endYear}`;
  }

  sliderMin.addEventListener("input", () => {
    startYear = +sliderMin.value;
    if (startYear > endYear) {
      startYear = endYear;
      sliderMin.value = startYear;
    }
    updateYearLabel();
    dispatchFilterChange("section");
  });

  sliderMax.addEventListener("input", () => {
    endYear = +sliderMax.value;
    if (endYear < startYear) {
      endYear = startYear;
      sliderMax.value = endYear;
    }
    updateYearLabel();
    dispatchFilterChange("section");
  });

  clearBtn.addEventListener("click", () => {
    applyState([], [minYear, maxYear], "section", true);
  });

  return {
    sectionId,
    getState() {
      return {
        states: [...activeStates],
        yearRange: [startYear, endYear],
        minYear,
        maxYear,
      };
    },
    setStates(nextStates, source = "sync") {
      applyState(nextStates, [startYear, endYear], source, false);
    },
    setYearRange(nextRange, source = "sync") {
      applyState(activeStates, nextRange, source, false);
    },
    reset(source = "section", emit = true) {
      applyState([], [minYear, maxYear], source, emit);
    },
  };
}

// ─── Population constants for per-capita ───
const POPULATIONS = {
  nsw: 8200000,
  vic: 6600000,
  qld: 5200000,
  wa: 2700000,
  sa: 1800000,
  tas: 560000,
  act: 460000,
  nt: 250000,
};

function buildSection01Insight(data, yearRange) {
  // Calculate tests per capita for each jurisdiction in latest year
  const latestYear = yearRange
    ? yearRange[1]
    : Math.max(...data.map((d) => d.YEAR).filter((y) => y != null));
  const rows = data.filter((d) => d.YEAR === latestYear);
  const perCapita = rows
    .map((d) => ({
      j: d.JURISDICTION,
      pc: (d.breath_test_conducted || 0) / (POPULATIONS[d.JURISDICTION] || 1),
    }))
    .filter((d) => d.pc > 0);

  if (perCapita.length < 2) return "";

  perCapita.sort((a, b) => b.pc - a.pc);
  const highest = perCapita[0];
  const lowest = perCapita[perCapita.length - 1];
  const ratio = (highest.pc / lowest.pc).toFixed(1);

  return `<strong>${highest.j.toUpperCase()}</strong> conducted <strong>${ratio}&times;</strong> more breath tests per capita than <strong>${lowest.j.toUpperCase()}</strong> in ${latestYear}, the widest enforcement gap in the dataset.`;
}

// ─── Main init ───
async function init() {
  try {
    const data = await loadAllData();
    let section3Metric = "alcohol";

    // Hide spinner
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-busy", "false");

    console.log(
      "%c All datasets loaded successfully",
      "color: #2E8B57; font-weight: bold;",
    );

    // Store globally for chart modules
    window.__DATA__ = data;

    // Populate KPIs
    populateKPIs(data);

    // Build filter bars for each section
    const filterControllers = {
      "section-01": buildFilterBar("section-01", data.alcoholDrug),
      "section-02": buildFilterBar("section-02", data.alcoholDrug),
      "section-03": buildFilterBar("section-03", data.breathTests),
      "section-04": buildFilterBar("section-04", data.fines),
    };

    // ── Init Section 1 charts ──
    initChoropleth("#choropleth-container", data.geoJSON, data.alcoholDrug);
    initBarChart("#barchart-container", data.alcoholDrug);

    // Section 1 insight
    const insight01 = document.getElementById("section-01-insight");
    if (insight01)
      insight01.innerHTML = buildSection01Insight(data.alcoholDrug);

    // ── Init Section 2 chart ──
    initDualAxis("#dualaxis-container", data.alcoholDrug, data.breathTests);

    // Section 2 insight
    const insight02 = document.getElementById("section-02-insight");
    if (insight02) {
      const insightText = computeDualAxisInsight(
        data.alcoholDrug,
        data.breathTests,
      );
      insight02.innerHTML = insightText;
    }

    // ── Init Section 3 charts ──
    initSlopeChart(
      "#slopechart-container",
      data.alcoholDrug,
      data.breathTests,
      data.drugTests,
      section3Metric,
    );
    initScatter(
      "#scatter-container",
      data.alcoholDrug,
      data.breathTests,
      data.drugTests,
      section3Metric,
    );

    // Section 3 insight
    const insight03 = document.getElementById("section-03-insight");
    if (insight03) {
      insight03.innerHTML = computeSection3Insight(
        data.alcoholDrug,
        data.breathTests,
        data.drugTests,
        section3Metric,
      );
    }

    const section03Toggle = document.getElementById("section-03-metric-toggle");
    if (section03Toggle) {
      section03Toggle.innerHTML = `
        <div class="dualaxis-toggle" role="group" aria-label="Section 3 metric">
          <button class="toggle-btn active" data-metric="alcohol" aria-pressed="true" type="button">Alcohol</button>
          <button class="toggle-btn" data-metric="drug" aria-pressed="false" type="button">Drug</button>
        </div>
      `;

      section03Toggle.addEventListener("click", (event) => {
        const btn = event.target.closest(".toggle-btn");
        if (!btn) return;
        const metric = btn.dataset.metric;
        if (!metric || metric === section3Metric) return;
        section3Metric = metric;

        section03Toggle.querySelectorAll(".toggle-btn").forEach((b) => {
          const active = b === btn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-pressed", String(active));
        });

        const st = filterControllers["section-03"]?.getState();
        const yr = st ? st.yearRange : null;
        const states = st ? st.states : [];
        queueSectionUpdate("section-03", yr, states);
      });
    }

    // ── Init Section 4 chart ──
    initStackedArea("#stackedarea-container", data.fines);
    renderSmallMultiples("#small-multiples-container", data.fines);

    // Section 4 insight
    const insight04 = document.getElementById("section-04-insight");
    if (insight04) {
      insight04.innerHTML = computeSection4Insight(data.fines);
    }

    // ── Footer year range ──
    const footerSource = document.getElementById("footer-source");
    if (footerSource) {
      const allYears = data.alcoholDrug
        .map((d) => d.YEAR)
        .filter((y) => y != null);
      const fYears = data.fines.map((d) => d.YEAR).filter((y) => y != null);
      const combinedYears = [...allYears, ...fYears];
      const minY = Math.min(...combinedYears);
      const maxY = Math.max(...combinedYears);
      footerSource.textContent = `Source: Bureau of Infrastructure and Transport Research Economics (BITRE), Police Enforcement Dataset. ${minY}\u2013${maxY}.`;
    }

    const pendingSectionUpdates = new Map();
    let framePending = false;

    function applySectionUpdate(sectionId, yr, states) {
      if (sectionId === "section-01") {
        updateChoropleth(data.alcoholDrug, yr, states);
        updateBarChart(data.alcoholDrug, yr, states);
        if (insight01)
          insight01.innerHTML = buildSection01Insight(data.alcoholDrug, yr);
      }

      if (sectionId === "section-02") {
        updateDualAxis(data.alcoholDrug, data.breathTests, yr, states);
      }

      if (sectionId === "section-03") {
        updateSlopeChart(
          data.alcoholDrug,
          data.breathTests,
          data.drugTests,
          yr,
          states,
          section3Metric,
        );
        updateScatter(
          data.alcoholDrug,
          data.breathTests,
          data.drugTests,
          yr,
          states,
          section3Metric,
        );
        if (insight03) {
          insight03.innerHTML = computeSection3Insight(
            data.alcoholDrug,
            data.breathTests,
            data.drugTests,
            section3Metric,
          );
        }
      }

      if (sectionId === "section-04") {
        updateStackedArea(data.fines, yr, states);
      }
    }

    function flushSectionUpdates() {
      pendingSectionUpdates.forEach(({ yearRange: yr, states }, sectionId) => {
        applySectionUpdate(sectionId, yr, states);
      });
      pendingSectionUpdates.clear();
      framePending = false;
    }

    function queueSectionUpdate(sectionId, yearRange, states) {
      pendingSectionUpdates.set(sectionId, { yearRange, states });
      if (!framePending) {
        framePending = true;
        requestAnimationFrame(flushSectionUpdates);
      }
    }

    document.addEventListener("filterchange", (e) => {
      const { sectionId, states, yearRange: yr, source } = e.detail;
      console.log("Filter changed:", e.detail);

      if (source === "map") {
        Object.values(filterControllers).forEach((ctrl) => {
          if (!ctrl) return;
          const st = ctrl.getState();
          ctrl.setStates(states, "map-sync");
          queueSectionUpdate(ctrl.sectionId, st.yearRange, states || []);
        });
        return;
      }

      queueSectionUpdate(sectionId, yr, states || []);
    });
  } catch (err) {
    console.error("Failed to load data:", err);
    const spinner = overlay.querySelector(".spinner");
    if (spinner) spinner.style.display = "none";
    errorBox.textContent = `Data failed to load. ${err.message || "Please check that all data files exist in the data/ directory."}`;
  }
}

// Set up nav interactions right away (no data dependency)
setupNavScroll();
setupNavHighlight();
setupMobileNav();

// Kick off async data loading
init();
