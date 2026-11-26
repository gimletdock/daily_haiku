import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";

const destination = fileURLToPath(new URL("../dist", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let file = resolve(destination, "." + path);
    if (file !== destination && !file.startsWith(destination + sep)) throw new Error("Invalid path");
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      ...(path.startsWith("/api/v1/") ? { "Access-Control-Allow-Origin": "*" } : {})
    }).end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});
const port = Number(process.env.HAIKU_PREVIEW_PORT ?? "4173");
server.listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}`));
