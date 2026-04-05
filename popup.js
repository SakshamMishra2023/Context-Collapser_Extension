document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("summaries-container");
  const sessionList = document.getElementById("session-list");
  const clearBtn = document.getElementById("clear-btn");
  const copyBtn = document.getElementById("copy-btn");
  const downloadBtn = document.getElementById("download-btn");
  const newSessionBtn = document.getElementById("new-session-btn");

  let allSummariesGrouped = {};
  let currentActiveSession = null;
  let topicSessions = [];
  let mapOfWindows = {};
  let thisChromeWindowId = null;

  // Create toast element dynamically
  const toast = document.createElement("div");
  toast.id = "toast";
  document.body.appendChild(toast);

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }

  function getCombinedText(summaries) {
    if (summaries.length === 0) return "No contexts found in this session.";
    
    const topicData = topicSessions.find(s => s.id === currentActiveSession);
    const sessionName = topicData ? topicData.name : currentActiveSession;

    let combined = "=========================================\n";
    combined += `      CONTEXT COLLAPSER EXPORT       \n`;
    combined += `      Topic: ${sessionName}    \n`;
    combined += "=========================================\n\n";

    summaries.forEach((item, index) => {
      const timeStr = new Date(item.timestamp).toLocaleString();
      combined += `[${index + 1}] ${item.title}\nURL: ${item.url}\nTime: ${timeStr}\n\nSUMMARY:\n${item.summary}\n\n-----------------------------------------\n\n`;
    });

    return combined;
  }
  
  function trimEmptySessions(callback) {
    // If a session has 0 summaries, AND it's not the currently bound one, delete it.
    let changed = false;
    let newSessions = topicSessions.filter(s => {
      const hasSummaries = (allSummariesGrouped[s.id] && allSummariesGrouped[s.id].length > 0);
      const isBoundToCurrentWindow = (mapOfWindows[thisChromeWindowId] === s.id);
      if (!hasSummaries && !isBoundToCurrentWindow) {
         changed = true;
         return false; // drop
      }
      return true; // keep
    });
    
    if (changed) {
      chrome.storage.local.set({ sessions: newSessions }, () => {
         topicSessions = newSessions;
         if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  function renderSidebar() {
    sessionList.innerHTML = "";
    
    if (topicSessions.length === 0) {
      sessionList.innerHTML = `<div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">No topics created.</div>`;
      return;
    }

    // Default to the session bound to this window, or the newest one
    if (!currentActiveSession) {
      if (mapOfWindows[thisChromeWindowId]) {
         currentActiveSession = mapOfWindows[thisChromeWindowId];
      } else {
         currentActiveSession = topicSessions[0].id; // newest created
      }
    }

    topicSessions.forEach((session) => {
      const el = document.createElement("div");
      el.className = `session-item ${session.id === currentActiveSession ? "active" : ""}`;
      
      const isCurrentWin = (mapOfWindows[thisChromeWindowId] === session.id);
      const summaryCount = allSummariesGrouped[session.id] ? allSummariesGrouped[session.id].length : 0;
      
      let badgeHtml = isCurrentWin 
        ? `<span style="font-size:8px; color:white; background:var(--primary); padding:2px 4px; border-radius:4px; margin-right:4px;">ACTIVE</span>` 
        : ``;

      el.innerHTML = `
        <svg class="session-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span style="flex:1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(session.name)}</span>
        ${badgeHtml}
        <span style="font-size: 10px; color: var(--text-muted); background: var(--bg-sidebar); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border);">${summaryCount}</span>
      `;

      el.addEventListener("click", () => {
        currentActiveSession = session.id;
        renderSidebar(); 
        renderMainView();
      });

      sessionList.appendChild(el);
    });
  }

  function renderMainView() {
    container.innerHTML = "";

    const summaries = allSummariesGrouped[currentActiveSession] || [];

    if (summaries.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg style="margin-bottom:12px; color:var(--text-muted);" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
          <br/>This topic folder is empty.<br/><br/>If this is the <b>ACTIVE</b> folder, just open browser tabs to automatically funnel summaries here!
        </div>`;
      return;
    }

    summaries.forEach((item) => {
      const card = document.createElement("div");
      card.className = "summary-card";

      const dateObj = new Date(item.timestamp);
      const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + dateObj.toLocaleDateString();

      card.innerHTML = `
        <h3 class="summary-title"><a href="${item.url}" target="_blank" title="${item.title}">${item.title}</a></h3>
        <div class="summary-time">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          ${timeStr}
        </div>
        <div class="summary-content">${escapeHTML(item.summary)}</div>
      `;
      container.appendChild(card);
    });
  }

  function loadData() {
    chrome.windows.getCurrent((win) => {
      thisChromeWindowId = win.id.toString();
      
      chrome.storage.local.get(["summaries", "sessions", "activeTopicMap"], (result) => {
        const flatSummaries = result.summaries || [];
        topicSessions = result.sessions || [];
        mapOfWindows = result.activeTopicMap || {};
        
        allSummariesGrouped = {};
        flatSummaries.forEach(item => {
          const sId = item.sessionId || 'unknown';
          if (!allSummariesGrouped[sId]) allSummariesGrouped[sId] = [];
          allSummariesGrouped[sId].push(item);
        });

        trimEmptySessions(() => {
           renderSidebar();
           renderMainView();
        });
      });
    });
  }

  const masterToggle = document.getElementById("master-toggle");
  const powerStatus = document.getElementById("power-status");
  const manualCollapseBtn = document.getElementById("manual-collapse-btn");

  // Observer for Background Process States
  const loadingOverlay = document.getElementById("loading-overlay");
  
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.isProcessing !== undefined) {
       if (changes.isProcessing.newValue === true) {
          loadingOverlay.classList.add("active");
       } else {
          loadingOverlay.classList.remove("active");
       }
    }
  });

  // Load master power state
  chrome.storage.local.get(['extensionEnabled', 'isProcessing'], (result) => {
    const isEnabled = result.extensionEnabled || false;
    masterToggle.checked = isEnabled;
    powerStatus.textContent = isEnabled ? "ON" : "OFF";
    powerStatus.style.color = isEnabled ? "var(--primary)" : "var(--text-muted)";
    
    if (result.isProcessing) loadingOverlay.classList.add("active");
  });

  masterToggle.addEventListener("change", (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
      powerStatus.textContent = isEnabled ? "ON" : "OFF";
      powerStatus.style.color = isEnabled ? "var(--primary)" : "var(--text-muted)";
      showToast(isEnabled ? "Extension Activated" : "Extension Paused");
      
      // If toggled ON, retroactively scan the window!
      if (isEnabled) {
         chrome.runtime.sendMessage({ action: "FORCE_EVALUATE" });
      }
    });
  });

  if (manualCollapseBtn) {
    manualCollapseBtn.addEventListener("click", () => {
       chrome.runtime.sendMessage({ action: "MANUAL_COLLAPSE" }, (response) => {
          if (response && response.status === "RATE_LIMIT") {
             alert("Limit Reached: You are summarizing tabs too quickly! Please wait a moment before collapsing another tab.");
          }
          // The background automatically deletes the tab on success, or fails.
       });
    });
  }

  // Event Listeners
  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", () => {
      const folderName = prompt("Name your new Research Topic Folder:");
      if (!folderName || folderName.trim().length === 0) return;
      
      const newId = "topic_virtual_" + Date.now();
      
      // Add to sessions
      topicSessions.unshift({
         id: newId,
         name: folderName.trim(),
         timestamp: new Date().toISOString()
      });
      
      // Bind it to current window
      mapOfWindows[thisChromeWindowId] = newId;
      
      // Save it and actively select it
      chrome.storage.local.set({ sessions: topicSessions, activeTopicMap: mapOfWindows }, () => {
         currentActiveSession = newId;
         loadData();
         showToast(`"${folderName}" is now active!`);
      });
    });
  }

  clearBtn.addEventListener("click", () => {
    if (!currentActiveSession) return;
    
    if (!confirm("Are you sure you want to delete all summaries in this topic?")) return;
    
    chrome.storage.local.get(["summaries"], (result) => {
      let flatSummaries = result.summaries || [];
      flatSummaries = flatSummaries.filter(item => (item.sessionId || 'unknown') !== currentActiveSession);
      
      chrome.storage.local.set({ summaries: flatSummaries }, () => {
        delete allSummariesGrouped[currentActiveSession];
        loadData(); // Re-load will auto-trim the session if it's no longer the active window binding
        showToast("Topic cleared!");
      });
    });
  });

  copyBtn.addEventListener("click", () => {
    const summaries = allSummariesGrouped[currentActiveSession] || [];
    if (summaries.length === 0) {
      showToast("Nothing to copy!");
      return;
    }
    const text = getCombinedText(summaries);
    navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard!")).catch(err => showToast("Failed to copy"));
  });

  downloadBtn.addEventListener("click", () => {
    const summaries = allSummariesGrouped[currentActiveSession] || [];
    if (summaries.length === 0) {
      showToast("Nothing to download!");
      return;
    }
    const text = getCombinedText(summaries);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `Context_Collapse_Export_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast("Download started!");
  });

  function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Go!
  loadData();
});
