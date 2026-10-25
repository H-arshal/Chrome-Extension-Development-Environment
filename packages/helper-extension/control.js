console.log("[ExtensionFlow Helper Control Tab] Initialized.");

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
        }))
      );
    });
  });
};
