import http from "node:http";

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("Hello, S2I with PNPM and TSX!\n");
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
