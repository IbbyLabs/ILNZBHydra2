import http from "node:http";
import net from "node:net";

const backendPort = Number.parseInt(process.env.BACKEND_PORT ?? "5077", 10);
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT ?? "3000", 10);
const externalPort = Number.parseInt(process.env.EXTERNAL_PORT ?? "5076", 10);

const backendPrefixes = [
  "/websocket",
  "/internalapi/",
  "/api",
  "/torznab/api",
  "/rss",
  "/getnzb",
  "/gettorrent",
  "/details",
  "/cache",
  "/actuator/",
];

function isBackendRoute(urlPath) {
  return backendPrefixes.some((prefix) => urlPath === prefix || urlPath.startsWith(prefix));
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const remote = req.socket.remoteAddress ?? "";
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return `${forwarded}, ${remote}`;
  }
  return remote;
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "undefined") {
    return "";
  }
  return String(value);
}

function buildProxyHeaders(req, targetPort) {
  const headers = { ...req.headers };
  headers.host = req.headers.host ?? `127.0.0.1:${targetPort}`;
  headers["x-real-ip"] = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = getClientIp(req);
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-port"] = String(externalPort);
  headers["x-forwarded-proto"] = "http";
  return headers;
}

function proxyHttpRequest(req, res) {
  const requestPath = req.url ?? "/";
  const targetPort = isBackendRoute(requestPath) ? backendPort : frontendPort;
  const headers = buildProxyHeaders(req, targetPort);

  const proxyReq = http.request(
    {
      host: "127.0.0.1",
      port: targetPort,
      method: req.method,
      path: requestPath,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`Bad gateway: ${error.message}`);
  });

  req.on("aborted", () => {
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
}

function writeUpgradeRequest(upstream, req, headers) {
  const requestLine = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}\r\n`;
  upstream.write(requestLine);
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        upstream.write(`${name}: ${normalizeHeaderValue(item)}\r\n`);
      }
      continue;
    }
    upstream.write(`${name}: ${normalizeHeaderValue(value)}\r\n`);
  }
  upstream.write("\r\n");
}

function proxyUpgrade(req, socket, head) {
  const requestPath = req.url ?? "/";
  const targetPort = isBackendRoute(requestPath) ? backendPort : frontendPort;
  const headers = buildProxyHeaders(req, targetPort);

  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    writeUpgradeRequest(upstream, req, headers);
    if (head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on("error", () => {
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });

  socket.on("error", () => {
    upstream.destroy();
  });
}

const server = http.createServer(proxyHttpRequest);
server.on("upgrade", proxyUpgrade);

server.listen(externalPort, "0.0.0.0", () => {
  process.stdout.write(`Ingress server listening on ${externalPort}\n`);
});