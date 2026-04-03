document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("summaries-container");
  const clearBtn = document.getElementById("clear-btn");

  function renderSummaries() {
    chrome.storage.local.get(["summaries"], (result) => {
      const summaries = result.summaries || [];
      container.innerHTML = "";

      if (summaries.length === 0) {
        container.innerHTML = `<div class="empty-state">No contexts collapsed yet. Open more than 3 tabs in a window to start collapsing!</div>`;
        return;
      }

      summaries.forEach((item) => {
        const card = document.createElement("div");
        card.className = "summary-card";

        // Format the date/time nicely
        const dateObj = new Date(item.timestamp);
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + dateObj.toLocaleDateString();

        card.innerHTML = `
          <h3 class="summary-title"><a href="${item.url}" target="_blank" title="${item.title}">${item.title}</a></h3>
          <div class="summary-time">${timeStr}</div>
          <div class="summary-content">${escapeHTML(item.summary)}</div>
        `;
        container.appendChild(card);
      });
    });
  }

  clearBtn.addEventListener("click", () => {
    chrome.storage.local.set({ summaries: [] }, () => {
      renderSummaries();
    });
  });

  // Small helper to prevent XSS if we render raw text into HTML
  function escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial render
  renderSummaries();
});
