import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const count = Number.parseInt(process.argv[2] ?? "1000", 10);
if (!Number.isFinite(count) || count <= 0) {
  throw new Error("Usage: pnpm bench:fixtures [positive-count]");
}

const root = path.resolve("fixtures", `bench-${count}`);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

await rm(root, { force: true, recursive: true });
await mkdir(root, { recursive: true });

for (let index = 0; index < count; index += 1) {
  const name = `photo-${String(index + 1).padStart(5, "0")}.png`;
  await writeFile(path.join(root, name), png);
}

console.log(`Created ${count} local benchmark images in ${root}`);
