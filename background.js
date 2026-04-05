// background.js

const closingTabIds = new Set();
let isProcessingLoop = false;

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.windowId) {
    checkTabLimit(tab.windowId);
  }
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  checkTabLimit(attachInfo.newWindowId);
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "FORCE_EVALUATE") {
    // If user explicitly requests scan, do it
    chrome.windows.getCurrent((w) => {
      checkTabLimit(w.id);
    });
    sendResponse({ status: "acknowledged" });
  } else if (message.action === "MANUAL_COLLAPSE") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs.length > 0) {
        const tab = tabs[0];
        closingTabIds.add(tab.id);
        chrome.storage.local.set({ isProcessing: true });
        const success = await summarizeAndClose(tab.id);
        chrome.storage.local.set({ isProcessing: false });
        closingTabIds.delete(tab.id);
        
        if (success === "__RATE_LIMIT__") {
          sendResponse({ status: "RATE_LIMIT" });
        } else {
          sendResponse({ status: "DONE" });
        }
      }
    });
    return true; // async response
  }
});

async function checkTabLimit(windowId) {
  if (isProcessingLoop) return;
  
  try {
    const { extensionEnabled = false } = await chrome.storage.local.get('extensionEnabled');
    if (!extensionEnabled) return; // Completely disabled by default
    
    isProcessingLoop = true;
    
    while (true) {
      const tabs = await chrome.tabs.query({ windowId: windowId });
      const activeTabs = tabs.filter(t => !closingTabIds.has(t.id));
      
      const LIMIT = 3;
      if (activeTabs.length <= LIMIT) {
        break; // We are under the limit!
      }
      
      // Sort tabs by their unique ID
      let sortedTabs = activeTabs.sort((a, b) => a.id - b.id);
      let oldestTab = sortedTabs[0];
      
      closingTabIds.add(oldestTab.id);
      
      // Indicate to UI that we are processing
      chrome.storage.local.set({ isProcessing: true });
      
      const result = await summarizeAndClose(oldestTab.id);
      
      closingTabIds.delete(oldestTab.id);
      chrome.storage.local.set({ isProcessing: false });
      
      if (result === "__RATE_LIMIT__") {
        console.warn("Rate limit hit during sequential crunch.");
        break; // Stop immediately so we don't spam Google
      }
    }
  } catch (e) {
    console.error("Tab tracking error:", e);
  } finally {
    isProcessingLoop = false;
    chrome.storage.local.set({ isProcessing: false });
  }
}

async function summarizeAndClose(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    
    // Prevent errors on internal pages
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      saveSummary(tab.title || "Unknown", tab.url, "Internal browser page, cannot extract content.", tab.windowId);
      chrome.tabs.remove(tabId);
      return "SUCCESS";
    }

    let extractedText = null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => document.body ? document.body.innerText : ''
      });
      if (results && results[0] && results[0].result) {
        extractedText = results[0].result;
      }
    } catch (e) {
      console.warn("Script injection failed. Might be a restricted page.", e);
    }
    
    let summaryText = "Could not retrieve content. The page might restrict extensions a restricted URL.";
    if (extractedText) {
      summaryText = await generateSummary(extractedText);
      if (summaryText === "__RATE_LIMIT__") {
        return "__RATE_LIMIT__"; // pass it up without closing the tab potentially, or still close it? 
        // User asked: "if at any point we hit the limit, show an alert... you are opening tabs too quickly". 
        // We probably shouldn't close the tab if we hit the limit, let the user read it!
      }
    }
    
    saveSummary(tab.title || "Unknown", tab.url, summaryText, tab.windowId);
    chrome.tabs.remove(tabId);
    return "SUCCESS";

  } catch (err) {
    console.error("Error summarizing and closing tab:", err);
    return "ERROR";
  }
}

async function generateSummary(text) {
  let cleanText = text.replace(/\s+/g, ' ').trim();
  if (cleanText.length === 0) return "No readable text found on page.";
  
  if (cleanText.length > 20000) {
    cleanText = cleanText.substring(0, 20000);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(['geminiApiKey'], async (result) => {
      const apiKey = result.geminiApiKey ? result.geminiApiKey.trim() : null;
      
      if (!apiKey) {
         let fallbackSummary = cleanText.length <= 250 ? cleanText : cleanText.substring(0, 250) + "...";
         resolve("[No API Key Set - Check Options] " + fallbackSummary);
         return;
      }

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: "Summarize the following webpage content into a brief, easy to read paragraph of 2 to 3 sentences max, ignore any text that is unimportant to the core content of the page:\n\n" + cleanText
              }]
            }]
          })
        });

        if (!response.ok) {
           if (response.status === 429) {
              resolve("__RATE_LIMIT__");
              return;
           }
           const errorBody = await response.text();
           console.error("Gemini API Error", response.status, errorBody);
           resolve(`API Error ${response.status}: ${errorBody.substring(0, 100)}...`);
           return;
        }

        const data = await response.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
           resolve(data.candidates[0].content.parts[0].text);
        } else {
           resolve("No summary generated by API.");
        }
      } catch (e) {
        console.error("Fetch error", e);
        resolve("Exception caught while summarizing: " + e.message);
      }
    });
  });
}

function saveSummary(title, url, summary, windowId) {
  chrome.storage.local.get(['summaries', 'activeTopicMap', 'sessions'], (result) => {
    const rawWindowId = windowId ? windowId.toString() : 'unknown';
    const activeMap = result.activeTopicMap || {};
    let sessionId = activeMap[rawWindowId];

    const sessions = result.sessions || [];
    if (!sessionId) {
      sessionId = 'virtual-' + rawWindowId;
      if (!sessions.find(s => s.id === sessionId)) {
         sessions.unshift({ 
           id: sessionId, 
           name: "Default Session", 
           timestamp: new Date().toISOString() 
         });
      }
    }

    const summaries = result.summaries || [];
    summaries.unshift({
      id: Date.now().toString(),
      title: title,
      url: url,
      summary: summary,
      timestamp: new Date().toISOString(),
      sessionId: sessionId
    });
    
    chrome.storage.local.set({ 
      summaries: summaries.slice(0, 50),
      sessions: sessions 
    });
  });
}
