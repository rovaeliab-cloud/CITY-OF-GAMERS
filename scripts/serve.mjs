import { createServer } from "node:http";
import { Readable } from "node:stream";
import { handleStore } from "../api/tienda.mjs";

import { localStorage } from "../lib/local-storage.mjs";
import { fileURLToPath } from "node:url";

const bindings = await localStorage(fileURLToPath(new URL("../.city-data/",import.meta.url)));
const port = Number(process.env.PORT || 3000);
const origin = "http://localhost:" + port;

createServer(async (incoming, outgoing) => {
  try {
    const init = { method: incoming.method, headers: incoming.headers };
    if (!["GET", "HEAD"].includes(incoming.method)) {
      init.body = incoming;
      init.duplex = "half";
    }
    const request = new Request(new URL(incoming.url, origin), init);
    const response = await handleStore(request, process.env, bindings);
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers["set-cookie"] = cookies;
    outgoing.writeHead(response.status, headers);
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500).end("No se pudo servir la solicitud.");
  }
}).listen(port, "127.0.0.1", () => console.log("CITY OF GAMERS · " + origin));
