import fs from "node:fs";
import path from "node:path";

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function extractValue(source, key) {
  if (!source) {
    return "";
  }
  const regex = new RegExp(`const\\s+${key}\\s*=\\s*"([^"]+)"`);
  const match = source.match(regex);
  return match && match[1] ? match[1] : "";
}

function printFingerprint(label, filePath, content) {
  const deployVersion = extractValue(content, "DEPLOY_VERSION");
  const startupMarker = extractValue(content, "STARTUP_MARKER");
  const exists = fs.existsSync(filePath);
  console.log(
    `[release-check] ${label} exists=${exists} file=${filePath} deployVersion=${deployVersion || "missing"} startupMarker=${startupMarker || "missing"}`
  );
  return { deployVersion, startupMarker, exists };
}

const projectRoot = process.cwd();
const srcServerPath = path.join(projectRoot, "src", "server.ts");
const distServerPath = path.join(projectRoot, "dist", "server.js");

const srcContent = readFileSafe(srcServerPath);
const distContent = readFileSafe(distServerPath);

const src = printFingerprint("src", srcServerPath, srcContent);
const dist = printFingerprint("dist", distServerPath, distContent);

if (
  src.exists &&
  dist.exists &&
  src.deployVersion &&
  dist.deployVersion &&
  (src.deployVersion !== dist.deployVersion || src.startupMarker !== dist.startupMarker)
) {
  console.warn("[release-check] src/dist fingerprint mismatch detected");
}
