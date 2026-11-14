// 경매의 신! - 실시간 서버 (Node.js + Socket.IO)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const G = require("./game");

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/healthz")) return res.end("ok");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
});
const io = new Server(server, { maxHttpBufferSize: 5e6 });
const rooms = new Map();

function newCode() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
  return c;
}
function flush(r) {
  r.touched = Date.now();
  for (const key of r.newAssets) io.to(r.code).emit("asset", { key, data: r.released[key] });
  r.newAssets = [];
  io.to(r.code).emit("state", G.pub(r));
}

io.on("connection", (s) => {
  s.data = {};
  const room = () => rooms.get(s.data.code);
  const host = () => { const r = room(); return r && s.data.role === "host" ? r : null; };

  s.on("create", (d, ack) => {
    if (typeof ack !== "function" || !d) return;
    const r = G.createRoom(newCode(), String(d.token || "").slice(0, 40));
    rooms.set(r.code, r);
    ack({ code: r.code });
  });

  s.on("join", (d, ack) => {
    if (typeof ack !== "function" || !d) return;
    const r = rooms.get(String(d.code || "").slice(0, 8));
    if (!r) return ack({ error: "방을 찾을 수 없어요. 코드를 확인해주세요." });
    const j = G.join(r, d);
    if (j.error) return ack({ error: j.error });
    s.data = { code: r.code, role: j.role, pid: j.pid };
    s.join(r.code);
    ack({ ok: true, role: j.role, pid: j.pid, code: r.code });
    s.emit("assets", r.released);
    if (j.role === "host") s.emit("cfg", G.cfgOf(r));
    s.broadcast.to(r.code).emit("state", G.pub(r));
    flush(r);
  });

  s.on("cfg", (d) => { const r = host(); if (!r) return; G.setConfig(r, d); flush(r); });
  s.on("img", (d) => { const r = host(); if (!r) return; G.setImg(r, d); flush(r); });
  s.on("start", () => { const r = host(); if (!r) return; const e = G.start(r); if (e) s.emit("toast", e); flush(r); });
  s.on("adv", () => { const r = host(); if (!r) return; G.adv(r); flush(r); });
  s.on("inc", (v) => { const r = host(); if (!r) return; G.setInc(r, v); flush(r); });
  s.on("restart", () => { const r = host(); if (!r) return; G.restart(r); flush(r); });

  s.on("bid", (d) => {
    const r = room(); if (!r || s.data.role !== "player") return;
    const e = G.bid(r, s.data.pid, d ? d.price : null);
    if (e) return s.emit("toast", e);
    flush(r);
  });
  s.on("loan", (d) => {
    const r = room(); if (!r || s.data.role !== "player" || !d) return;
    G.loan(r, s.data.pid, d.amt);
    flush(r);
  });

  s.on("disconnect", () => {
    const r = room(); if (!r) return;
    if (s.data.role === "host") r.hostOn = false;
    else { const p = r.players.find((x) => x.id === s.data.pid); if (p) p.on = false; }
    flush(r);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [c, r] of rooms) if (now - r.touched > 6 * 3600 * 1000) rooms.delete(c);
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log("경매의 신! 서버 실행 중: http://localhost:" + PORT));
