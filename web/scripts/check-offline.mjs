import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import woff2 from "wawoff2";

const prefixes = ["http://", "https://", "www."];
function checkBytes(bytes, file) {
  // Removing NULs also catches URLs in UTF-16 name tables in either byte order.
  const text = bytes.toString("latin1").replaceAll("\0", "").toLowerCase();
  if (prefixes.some((prefix) => text.includes(prefix)))
    throw new Error("Web address in " + file);
}

function checkPngMetadata(bytes, file) {
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    at += length + 12;
    if (!["zTXt", "iTXt", "iCCP"].includes(type)) continue;
    const keywordEnd = data.indexOf(0);
    let start = keywordEnd + 2;
    if (type === "iTXt") {
      if (data[keywordEnd + 1] !== 1) continue; // Uncompressed text was already scanned.
      const languageEnd = data.indexOf(0, keywordEnd + 3);
      start = data.indexOf(0, languageEnd + 1) + 1;
    }
    checkBytes(inflateSync(data.subarray(start)), file + " (" + type + ")");
  }
}

async function checkDirectory(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    checkBytes(Buffer.from(entry.name), file);
    if (entry.isDirectory()) {
      await checkDirectory(file);
      continue;
    }
    const bytes = readFileSync(file);
    checkBytes(bytes, file);
    if (bytes.toString("ascii", 1, 4) === "PNG") checkPngMetadata(bytes, file);
    if (bytes.toString("ascii", 0, 4) === "wOF2") {
      checkBytes(
        Buffer.from(await woff2.decompress(bytes)),
        file + " (decoded font)",
      );
    }
  }
}

if (!process.argv[2])
  throw new Error("Pass the built or unpacked game directory.");
for (const directory of process.argv.slice(2)) await checkDirectory(directory);
