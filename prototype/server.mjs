import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Normalize away the trailing separator returned by fileURLToPath on Windows.
// Otherwise `${root}${sep}` contains a doubled separator and every valid file
// is rejected by the containment check below.
const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env.STARCARE_PORT) || 4173;
const baseArgument = process.argv.find((argument) => argument.startsWith("--base="));
const requestedBase = baseArgument?.slice("--base=".length) || "/";
const basePath = `/${requestedBase.replace(/^\/+|\/+$/g, "")}${requestedBase === "/" ? "" : "/"}`;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    const baseWithoutSlash = basePath === "/" ? "/" : basePath.slice(0, -1);
    if (basePath !== "/" && pathname === baseWithoutSlash) {
      response.writeHead(302, { Location: `${basePath}${url.search}` }).end();
      return;
    }
    if (!pathname.startsWith(basePath)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const localPath = pathname.slice(basePath.length);
    const relative = localPath === "" ? "/index.html" : `/${localPath}`;
    const target = resolve(root, `.${relative}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Starcare Hollow prototype: http://${host}:${port}${basePath}`);
});
