/**
 * tooltip.js
 * Shared tooltip singleton for all charts.
 */

const tooltipEl = document.createElement("div");
tooltipEl.id = "tooltip";
tooltipEl.setAttribute("role", "tooltip");
tooltipEl.setAttribute("aria-hidden", "true");
Object.assign(tooltipEl.style, {
  position: "absolute",
  pointerEvents: "none",
  opacity: "0",
  background: "#FFFFFF",
  border: "1px solid #E0DEDA",
  borderRadius: "8px",
  padding: "12px",
  fontSize: "12px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
  minWidth: "140px",
  transition: "opacity 150ms ease",
  zIndex: "1000",
  lineHeight: "1.5",
  color: "#1A1A1A",
  fontFamily: "'Inter', sans-serif",
});
document.body.appendChild(tooltipEl);

const liveRegion = document.getElementById("chart-live-region");
let lastMouse = null;

function stripHtml(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").trim();
}

export const tooltip = {
  /**
   * Show the tooltip near the mouse, keeping it within the viewport.
   * @param {string} htmlString - innerHTML content
   * @param {MouseEvent} event - the mouse event for positioning
   */
  show(htmlString, event) {
    if (htmlString != null) {
      tooltipEl.innerHTML = htmlString;
      if (liveRegion) {
        liveRegion.textContent = stripHtml(htmlString);
      }
    }
    tooltipEl.style.opacity = "1";
    tooltipEl.setAttribute("aria-hidden", "false");

    if (event && lastMouse) {
      const dx = event.pageX - lastMouse.x;
      const dy = event.pageY - lastMouse.y;
      if (Math.hypot(dx, dy) <= 4) {
        return;
      }
    }

    if (event) {
      lastMouse = { x: event.pageX, y: event.pageY };
    }

    const pad = 12;
    const pageX = event ? event.pageX : lastMouse ? lastMouse.x : 0;
    const pageY = event ? event.pageY : lastMouse ? lastMouse.y : 0;
    let x = pageX + pad;
    let y = pageY + pad;

    // Measure after setting content
    const rect = tooltipEl.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    // Keep within right edge
    if (x + rect.width > viewW + window.scrollX) {
      x = pageX - rect.width - pad;
    }

    // Keep within bottom edge
    if (y + rect.height > viewH + window.scrollY) {
      y = pageY - rect.height - pad;
    }

    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = y + "px";
  },

  /**
   * Hide the tooltip.
   */
  hide() {
    tooltipEl.style.opacity = "0";
    tooltipEl.setAttribute("aria-hidden", "true");
    if (liveRegion) {
      liveRegion.textContent = "";
    }
    lastMouse = null;
  },
};
