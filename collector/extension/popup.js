const result = document.getElementById('result');

async function collect(action) {
  result.textContent = 'Reading visible usage…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Open a provider usage page first.');
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ url: location.href, text: document.body?.innerText ?? '' })
    });
    if (!injection?.result) throw new Error('The usage page could not be read.');
    const response = await chrome.runtime.sendNativeMessage('com.llm_usage.collector', {
      action, url: injection.result.url, text: injection.result.text
    });
    if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
    if (response?.error) throw new Error(response.error);
    if (action === 'sync') {
      result.textContent = `${response.account_id}: ${response.status} (${response.result})`;
    } else {
      const limits = response.limits.map(limit =>
        `${limit.kind} ${limit.scope}: ${limit.remaining_fraction === null ? 'unknown' : Math.round(limit.remaining_fraction * 100) + '% left'}`);
      result.textContent = `${response.account_id}: ${response.status}\n${limits.join('\n') || 'No usage meters found'}`;
    }
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : 'Collection failed';
  }
}

document.getElementById('preview').addEventListener('click', () => collect('preview'));
document.getElementById('sync').addEventListener('click', () => collect('sync'));
