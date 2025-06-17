import { searchToken } from './services/jupiterService';
import { CoinCreationParams } from './types';
import { logEventToFirestore } from './firebase';
// Retrieve content script loader file paths from manifest for dynamic injection
const _manifest = chrome.runtime.getManifest() as any;
const _contentScriptFiles: string[] = (_manifest.content_scripts?.[0]?.js as string[]) || [];

// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Handle content script injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: _contentScriptFiles
    }).catch(err => console.error('Failed to inject content script:', err));
  }
});

// Track content script status per tab
const contentScriptStatus = new Map<number, boolean>();

function isValidForCoinCreateTrigger(obj: Record<string, any>): boolean {
  return (
    obj &&
    typeof obj === 'object' &&
    (
      typeof obj.name === 'string' ||
      typeof obj.ticker === 'string' ||
      typeof obj.imageUrl === 'string' ||
      typeof obj.description === 'string'
    )
  );
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  // Determine target tab: provided in message or from sender.tab
  const targetTabId = message.tabId ?? sender.tab?.id;
  if (!targetTabId) return;
  // Handle ping to log active wallet once for metrics/airdrops
  if (message.type === 'PING_ACTIVE_WALLET') {
    // Check if we've already logged the wallet
    chrome.storage.local.get(['walletLogged'], (items) => {
      if (items.walletLogged) return;
      // Retrieve stored wallets and activeWalletId
      chrome.storage.local.get(['wallets', 'activeWalletId'], (data) => {
        const wallets = data.wallets as any[];
        const activeWalletId = data.activeWalletId as string;
        if (Array.isArray(wallets) && activeWalletId) {
          const active = wallets.find(w => w.id === activeWalletId);
          const walletAddress = active?.publicKey;
          if (walletAddress) {
            logEventToFirestore('wallet_active', { walletAddress, timestamp: new Date().toISOString() })
              .catch(err => console.error('Error logging active wallet event:', err));
            chrome.storage.local.set({ walletLogged: true });
          }
        }
      });
    });
    return;
  }

  // Messages from content script to background
  if (message.type === 'CONTENT_SCRIPT_READY') {
    contentScriptStatus.set(targetTabId, true);
  }
  // Trigger injection and start selection mode (e.g., from popup)
  else if (message.type === 'INJECT_CONTENT_SCRIPT') {
    if (!contentScriptStatus.get(targetTabId)) {
      chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: _contentScriptFiles
      })
      .then(() => {
        console.log('Re-injecting content script and starting selection mode');
        chrome.tabs.sendMessage(targetTabId, { type: 'START_SELECT_MODE' });
      })
      .catch(err => console.error('Failed to re-inject content script:', err));
    } else {
      console.log('Already injected: directly start selection mode');
      chrome.tabs.sendMessage(targetTabId, { type: 'START_SELECT_MODE' });
    }
  }
  // Handle user content selection from page
  else if (message.type === 'CONTENT_SELECTED') {
    const content = message.content;
    const isSidebarMsg = message.isSidebar === true;
    // Store selected content for UI
    chrome.storage.local.set({ selectedContent: JSON.stringify(content) }, () => {
      // Only open popup when not in sidebar context - sidebar should already be open if active
      if (!isSidebarMsg) {
        chrome.action.openPopup().catch(err => console.error('Failed to open popup:', err));
      }
      // If sidebar is active, it will automatically pick up the new content from storage
    });
  }
  // Handle token buy button clicks from content script
  else if (message.type === 'TKNZ_TOKEN_CLICKED') {
    const token = message.token;

    // Handle click asynchronously: blocklist check and token validation
    (async () => {
      try {
        console.log('TKNZ_TOKEN_CLICKED', token);
        // Retrieve blocklist from storage
        const items: any = await new Promise(resolve =>
          chrome.storage.local.get(['blocklist'], resolve)
        );
        const blocklist: string[] = Array.isArray(items.blocklist) ? items.blocklist : [];
        const tokenId = token.address || token.symbol;
        if (blocklist.includes(tokenId)) {
          console.log('Token is blocklisted:', tokenId);
          sendResponse({ success: false, reason: 'blocked' });
          return;
        }

        // Validate token: if symbol provided, lookup via searchToken; skip lookup for provided contract address
        if (!token.address && token.symbol) {
          try {
            console.log('Searching for token by symbol:', token.symbol);
            const asset = await searchToken(token.symbol);
            // No matching asset
            if (!asset?.id) {
              console.error('Token validation failed (no asset found):', token.symbol);
              sendResponse({ success: false, reason: 'unsupported' });
              return;
            }
            // Set contract address
            token.address = asset.id;
            // Ensure valid price and organic score
            if (asset.usdPrice <= 0 || asset.organicScore <= 0) {
              console.error('Token validation failed (unsupported):', token.address);
              sendResponse({ success: false, reason: 'unsupported' });
              return;
            }
          } catch (err) {
            console.error('Failed to lookup token by symbol:', token.symbol, err);
            sendResponse({ success: false, reason: 'unknown' });
            return;
          }
        }
        console.log('token', token);
        
        // Store the last buy token for UI
        chrome.storage.local.set({ lastBuyToken: JSON.stringify(token) });
        
        // Use context flag from content script
        const isSidebarMsg = message.isSidebar === true;

        // If sidebar is already active, just send the message
        // Otherwise open popup - never programmatically open sidebar
        if (!isSidebarMsg) {
          try {
            await chrome.action.openPopup();
          } catch (err) {
            console.error('Failed to open popup:', err);
            sendResponse({ success: false, reason: 'popup' });
            return;
          }
        }

        // Notify UI to show swap page
        chrome.runtime.sendMessage({ type: 'SHOW_SWAP', token, isSidebar: isSidebarMsg });

        // Everything succeeded
        sendResponse({ success: true });
      } catch (err) {
        console.error('Error in token click handler:', err);
        sendResponse({ success: false, reason: 'unknown' });
      }
    })();
    return true;
  }
  else if (message.type === 'CONNECT') {
    (async () => {
      try {
        // Open extension popup for connect UI
        await chrome.action.openPopup();
      } catch (e) {
        console.error('Failed to open popup for connect:', e);
      }
      chrome.storage.local.get(['wallets', 'activeWalletId'], (data) => {
        const wallets: any[] = Array.isArray(data.wallets) ? data.wallets : [];
        const activeId: string = data.activeWalletId;
        const active = wallets.find(w => w.id === activeId);
        sendResponse({ success: true, publicKey: active?.publicKey });
      });
    })();
    return true;
  }
  else if (message.type === 'SIGN_TRANSACTION') {
    // Forward to UI for confirmation/signing. We keep the response callback
    // open so that we can resolve it once the user confirms in the popup UI.
    // The listener must return `true` to signal asynchronous response.

    const requestId = `req_${Date.now()}_${Math.random()}`;

    // Relay the transaction to the extension UI (popup / side panel).
    chrome.runtime.sendMessage({
      type: 'SHOW_SIGN_TRANSACTION',
      requestId,
      transaction: message.transaction,
    });

    // Ensure the popup window is visible for user confirmation.
    chrome.action.openPopup().catch(err => {
      console.error('Failed to open popup for transaction signing:', err);
    });

    // Store resolver so we can respond later once signing is complete.
    const resolver = (responseMsg: any) => {
      if (
        responseMsg?.type === 'SIGN_TRANSACTION_CONFIRMED' &&
        responseMsg.requestId === requestId
      ) {
        // Send the signed tx back to content script.
        sendResponse({ signedTransaction: responseMsg.signedTransaction });
        chrome.runtime.onMessage.removeListener(resolver);
      }
      if (
        responseMsg?.type === 'SIGN_TRANSACTION_REJECTED' &&
        responseMsg.requestId === requestId
      ) {
        sendResponse({});
        chrome.runtime.onMessage.removeListener(resolver);
      }
    };

    chrome.runtime.onMessage.addListener(resolver);

    // Indicate async response.
    return true;
  }
  else if (message.type === 'SIGN_ALL_TRANSACTIONS') {
    const requestId = `req_${Date.now()}_${Math.random()}`;
    chrome.runtime.sendMessage({
      type: 'SHOW_SIGN_ALL_TRANSACTIONS',
      requestId,
      transactions: message.transactions,
    });

    chrome.action.openPopup().catch(err => {
      console.error('Failed to open popup for transaction signing:', err);
    });

    const resolver = (responseMsg: any) => {
      if (
        responseMsg?.type === 'SIGN_ALL_TRANSACTIONS_CONFIRMED' &&
        responseMsg.requestId === requestId
      ) {
        sendResponse({ signedTransactions: responseMsg.signedTransactions });
        chrome.runtime.onMessage.removeListener(resolver);
      }
      if (
        responseMsg?.type === 'SIGN_ALL_TRANSACTIONS_REJECTED' &&
        responseMsg.requestId === requestId
      ) {
        sendResponse({});
        chrome.runtime.onMessage.removeListener(resolver);
      }
    };

    chrome.runtime.onMessage.addListener(resolver);

    return true;
  }
  else if (message.type === 'SIGN_MESSAGE') {
    chrome.runtime.sendMessage({ type: 'SHOW_SIGN_MESSAGE', message: message.message });
    sendResponse({ success: true });
    return true;
  }
  else if (message.type === 'GET_PUBLIC_KEY') {
    chrome.storage.local.get(['wallets', 'activeWalletId'], (data) => {
      const wallets: any[] = Array.isArray(data.wallets) ? data.wallets : [];
      const active = wallets.find(w => w.id === data.activeWalletId);
      sendResponse({ success: true, publicKey: active?.publicKey });
    });
    return true;
  }
  // Initialize token creation via content script SDK
  else if (message.type === 'INIT_TOKEN_CREATE') {
    if (!isValidForCoinCreateTrigger(message.options)) {
      console.log('invalid coin create trigger');
      sendResponse({ success: false, reason: 'Missing or invalid required fields' });
      return false;
    }
    const options = message.options || {};
    const isSidebarMsg = message.isSidebar === true;
    (async () => {
      try {
        chrome.storage.local.set({ initCoinData: JSON.stringify(message.options) });
      } catch (e) {
        console.error('Failed to populate token:', e);
      }

      if (!isSidebarMsg) {
        try {
          await chrome.action.openPopup();
        } catch (err) {
          console.error('Failed to open popup:', err);
          sendResponse({ success: false, reason: 'popup' });
          return;
        }
      }

      chrome.runtime.sendMessage({ type: 'SDK_TOKEN_CREATE', options, isSidebar: isSidebarMsg });
      sendResponse({ success: true });
    })();

    return true;
  }

  return true;
});

// Inject SDK into page context
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'INJECT_SDK' && sender.tab?.id) {
    console.log(`BACKGROUND: Received INJECT_SDK for tab ${sender.tab.id}`);
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: true },
      world: 'MAIN',
      func: () => {
        console.log('CONTENT SCRIPT: injecting window.tknz SDK');
        const post = (data: any) => {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(data, '*');
          } else {
            window.postMessage(data, '*');
          }
        };
        (window as any).tknz = {
          initTokenCreate: (coin: any) => post({ source: 'tknz', type: 'INIT_TOKEN_CREATE', options: coin }),
          connect: () => post({ source: 'tknz', type: 'CONNECT' }),
          signTransaction: (tx: string) => post({ source: 'tknz', type: 'SIGN_TRANSACTION', transaction: tx }),
          signAllTransactions: (txs: string[]) => post({ source: 'tknz', type: 'SIGN_ALL_TRANSACTIONS', transactions: txs }),
          signMessage: (msg: string) => post({ source: 'tknz', type: 'SIGN_MESSAGE', message: msg }),
          getPublicKey: () => post({ source: 'tknz', type: 'GET_PUBLIC_KEY' })
        };
      }
    }).then(() => {
      console.log(`BACKGROUND: Successfully injected SDK into tab ${sender.tab.id}`);
    }).catch((err) => {
      console.error(`BACKGROUND: Failed to inject SDK into tab ${sender.tab.id}`, err);
    });
  }
});

// Clean up content script status when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  contentScriptStatus.delete(tabId);
}); 