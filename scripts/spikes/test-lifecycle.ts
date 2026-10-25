import {
  launchCfT,
  getHelperExtensionPath,
  getStorageFixturePath,
} from "./browser-helper.js";

async function testWorkerEval() {
  const session = await launchCfT({
    extensions: [getHelperExtensionPath(), getStorageFixturePath()],
    headless: false,
  });

  await new Promise((r) => setTimeout(r, 2000));
  const helper = session.browser
    .targets()
    .find((t) => t.url().includes("eomflhagkmibofdkojpcjbjbhmmjcckc"));

  const helperWorker = await helper?.worker();
  console.log("Helper worker found:", !!helperWorker);

  // Read list using worker evaluate
  const list = await helperWorker?.evaluate(() =>
    globalThis.__extensionflow_list()
  );
  console.log("List from worker evaluate:", list);

  const fixture = list?.find((e: any) => e.name.includes("Storage"));
  console.log("Fixture ID:", fixture?.id);

  // Find fixture worker
  const fixtureTarget = session.browser
    .targets()
    .find((t) => t.url().includes(fixture.id));
  const fixtureWorker = await fixtureTarget?.worker();
  console.log("Fixture worker found:", !!fixtureWorker);

  // Set data
  const writeRes = await fixtureWorker?.evaluate((data) => {
    return globalThis.__setStorageData(data);
  }, { count: 999, label: "preserved" });
  console.log("Storage written:", writeRes);

  // Reload via helper
  console.log("Reloading via helper...");
  const reloadRes = await helperWorker?.evaluate((id) => {
    return globalThis.__extensionflow_reload(id);
  }, fixture.id);
  console.log("Reload result:", reloadRes);

  // Wait for new target
  console.log("Waiting for new service worker target...");
  const newTarget = await session.browser.waitForTarget(
    (t) => t.url().includes(fixture.id) && t.type() === "service_worker",
    { timeout: 5000 }
  );
  console.log("New target acquired:", newTarget.url());

  const newWorker = await newTarget.worker();
  console.log("New worker acquired:", !!newWorker);

  const readRes = await newWorker?.evaluate(() => {
    return globalThis.__getStorageData();
  });
  console.log("Storage post-reload:", readRes);

  if (readRes?.count === 999 && readRes?.label === "preserved") {
    console.log(">>> STORAGE PERSISTENCE VERIFIED PERFECTLY! <<<");
  }

  await session.close();
}

testWorkerEval().catch(console.error);
