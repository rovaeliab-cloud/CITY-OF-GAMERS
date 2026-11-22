import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));
const output = join(project, "dist");
const manifest = join(project, ".openai", "hosting.json");
const worker = join(project, "worker", "index.js");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
};

async function collectAssets(directory, prefix = "") {
  const assets = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((first, second) => first.name.localeCompare(second.name, "en"));
  for (const entry of entries) {
    const { name } = entry;
    if (!prefix && (name === "server" || name === ".openai")) continue;
    const path = join(directory, name);
    const key = `${prefix}/${name}`;
    if (entry.isDirectory()) {
      assets.push(...await collectAssets(path, key));
    } else if (entry.isFile()) {
      const contentType = contentTypes[extname(name).toLowerCase()] || "application/octet-stream";
      const bytes = await readFile(path);
      assets.push([key, contentType.endsWith("charset=utf-8")
        ? { contentType, body: bytes.toString("utf8") }
        : { contentType, body: bytes.toString("base64"), base64: true }]);
    } else {
      throw new Error(`Unsupported asset: ${key}`);
    }
  }
  return assets;
}

const [settings, workerSource, assetEntries, defaults, cmsSource] = await Promise.all([
  readFile(manifest, "utf8").then(JSON.parse),
  readFile(worker, "utf8"),
  collectAssets(output),
  readFile(join(project, "worker/defaults.json"), "utf8").then(JSON.parse),
  readFile(join(project, "worker/cms.js"), "utf8"),
]);
if (!settings.project_id || Object.hasOwn(settings, "static")) {
  throw new Error("Expected a Worker hosting manifest with a project ID.");
}
const assets = Object.fromEntries(assetEntries);
if (!Object.hasOwn(assets, "/index.html")) throw new Error("dist/index.html is missing.");

await mkdir(join(output, "server"), { recursive: true });
await mkdir(join(output, ".openai"), { recursive: true });
await Promise.all([
  writeFile(
    join(output, "server", "index.js"),
    `const siteAssets = ${JSON.stringify(assets)};\n\nconst storeDefaults = ${JSON.stringify(defaults)};\n\n${cmsSource}\n\n${workerSource}\n`,
  ),
  copyFile(manifest, join(output, ".openai", "hosting.json")),
]);
console.log(`Built Worker with ${assetEntries.length} embedded assets.`);
