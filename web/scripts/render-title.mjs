import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(
  new URL("../public/assets/flick-soccer-cover.png", import.meta.url),
);
function checkFreshness(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) checkFreshness(path);
    else if (
      path !== output &&
      statSync(path).mtimeMs > statSync(output).mtimeMs
    )
      throw new Error("Rebuild the title card after changing " + path);
  }
}
if (process.argv.includes("--check")) {
  for (const folder of ["src", "public", "tools"])
    checkFreshness(join(root, folder));
  process.exit(0);
}
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1,
  });
  await page.goto(
    "http://127.0.0.1:" +
      server.httpServer.address().port +
      "/tools/title-card.html",
  );
  await page.waitForSelector('html[data-ready="true"]');
  await page.locator("canvas").screenshot({ path: output });
  console.log("Rendered current title card at " + output);
} finally {
  await browser.close();
  await server.close();
}
