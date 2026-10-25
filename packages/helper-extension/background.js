console.log("[ExtensionFlow Helper] Service Worker running with ID:", chrome.runtime.id);

/**
 * Disables and immediately re-enables an extension by ID.
 * This forces Chrome to reload the unpacked files from disk while preserving chrome.storage.
 */
globalThis.__extensionflow_reload = function (extensionId) {
  return new Promise((resolve, reject) => {
    chrome.management.setEnabled(extensionId, false, () => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      chrome.management.setEnabled(extensionId, true, () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve({ success: true, extensionId });
      });
    });
  });
};

/**
 * Lists all extensions visible to the management API.
 */
globalThis.__extensionflow_list = function () {
  return new Promise((resolve, reject) => {
    chrome.management.getAll((extensions) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(
        extensions.map((ext) => ({
          id: ext.id,
          name: ext.name,
          enabled: ext.enabled,
          version: ext.version,
          installType: ext.installType,
        }))
      );
    });
  });
};
