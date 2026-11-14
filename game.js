"use strict";
// 경매의 신! - 게임 규칙 (소켓과 무관한 순수 로직)
const INCS = [10000, 50000, 100000, 500000, 1000000, 5000000];
const rid = () => Math.random().toString(36).slice(2, 8);
const clamp = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const str = (s, n) => String(s == null ? "" : s).replace(/[<>]/g, "").slice(0, n);
const okImg = (s) => typeof s === "string" && s.length < 900000 && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);
const nf = (n) => Math.round(n).toLocaleString("en-US") + "원";
const mk = (name, emoji, start, value) => ({ uid: rid() + rid(), name, emoji, start, value });

function defaultRounds() {
  return [
    { theme: "보물 사냥", items: [mk("황금 오리", "🦆", 1000000, 2500000), mk("고대 보물지도", "🗺️", 2000000, 1500000)] },
    { theme: "수상한 거래", items: [mk("수상한 선물상자", "🎁", 500000, 4000000), mk("거대 다이아몬드", "💎", 5000000, 8000000)] },
    { theme: "출출할 땐", loan: 10000000, items: [mk("우주 라면", "🍜", 300000, 100000)] },
  ];
}
const loanOf = (rounds, ri) => {
  const r = rounds[ri];
  if (r && r.loan != null) return r.loan;
  return ri < 2 ? 0 : ri === 2 ? 1e7 : ri === 3 ? 5e7 : 1e8;
};

function createRoom(code, hostToken) {
  return {
    code, hostToken, hostOn: false, phase: "lobby", budget: 50000000, rate: 30, inc: 10000,
    rounds: defaultRounds(), players: [], imgs: {}, released: {}, newAssets: [],
    games: [], flat: [], rg: [], R: 0, i: 0, cur: 0, leader: null, bids: {}, last: null, limit: 0,
    rl: [], rev: 0, shown: false, settleRows: [], touched: Date.now(),
  };
}
function release(r, key) {
  if (r.imgs[key] && !r.released[key]) { r.released[key] = r.imgs[key]; r.newAssets.push(key); }
}
function cfgOf(r) {
  return { budget: r.budget, rate: r.rate, rounds: r.rounds.map((rd) => ({ theme: rd.theme, loan: rd.loan, items: rd.items.map((o) => ({ uid: o.uid, name: o.name, emoji: o.emoji, start: o.start, value: o.value })) })) };
}
function setConfig(r, d) {
  if (r.phase !== "lobby" || !d) return;
  r.budget = clamp(d.budget, 100000, 1e11, r.budget);
  r.rate = clamp(d.rate, 0, 300, r.rate);
  if (Array.isArray(d.rounds)) {
    r.rounds = d.rounds.slice(0, 10).map((rd) => ({
      theme: str(rd.theme, 30).trim(),
      loan: rd.loan == null ? undefined : clamp(rd.loan, 0, 1e10, 0),
      items: (Array.isArray(rd.items) ? rd.items : []).slice(0, 12).map((o) => ({
        uid: str(o.uid, 20) || rid() + rid(), name: str(o.name, 14) || "물품", emoji: str(o.emoji, 4) || "📦",
        start: clamp(o.start, 0, 1e10, 1000000), value: clamp(o.value, 0, 1e11, 1000000),
      })),
    }));
  }
  r.players.forEach((p) => (p.money = r.budget));
}
function setImg(r, d) {
  if (r.phase !== "lobby" || !d || !okImg(d.data)) return;
  const slot = d.slot === 2 ? 2 : 1, uid = str(d.uid, 24);
  if (!uid) return;
  const key = uid + ":" + slot;
  r.imgs[key] = d.data;
  if (uid === "host") { delete r.released[key]; release(r, key); }
}
function join(r, d) {
  const token = str(d.token, 40);
  if (token && token === r.hostToken) { r.hostOn = true; return { role: "host", pid: null }; }
  let p = r.players.find((x) => x.token === token);
  if (!p) {
    if (r.phase !== "lobby") return { error: "이미 게임이 시작된 방이에요." };
    if (r.players.length >= 8) return { error: "방이 가득 찼어요 (최대 8명)." };
    p = { id: rid(), token, name: str(d.name, 8).trim() || "참가자", emoji: str(d.emoji, 4) || "🙂", money: r.budget, won: [], loan: 0, on: true };
    r.players.push(p);
    if (okImg(d.img)) { const k = "p:" + p.id + ":1"; r.imgs[k] = d.img; release(r, k); }
  }
  p.on = true;
  return { role: "player", pid: p.id };
}
function start(r) {
  if (r.phase !== "lobby") return "x";
  const gs = r.rounds.map((rd, ri) => ({ theme: rd.theme, loan: loanOf(r.rounds, ri), items: rd.items })).filter((g) => g.items.length);
  if (!gs.length) return "물품이 있는 라운드가 최소 1개 필요해요";
  if (!r.players.length) return "참가자가 아직 없어요";
  r.games = gs; r.flat = []; r.rg = [];
  gs.forEach((g) => { const a = r.flat.length; r.flat.push(...g.items); r.rg.push([a, r.flat.length]); });
  r.players.forEach((p) => { p.money = r.budget; p.won = []; p.loan = 0; });
  r.R = 0; r.inc = INCS.includes(r.inc) ? r.inc : 10000;
  intro(r);
  return null;
}
function intro(r) { r.phase = "intro"; r.i = r.rg[r.R][0]; r.leader = null; r.bids = {}; r.last = null; }
function startAuction(r) {
  const it = r.flat[r.i];
  r.phase = "auction"; r.cur = it.start; r.leader = null; r.bids = {}; r.last = null;
  release(r, it.uid + ":1");
}
const minBid = (r) => (r.leader == null ? r.flat[r.i].start : r.cur + r.inc);
function sell(r) {
  const it = r.flat[r.i];
  if (r.leader != null) {
    const p = r.players.find((x) => x.id === r.leader);
    p.money -= r.cur; p.won.push({ idx: r.i, price: r.cur });
    r.last = { sold: true, pid: p.id, price: r.cur };
  } else r.last = { sold: false };
  r.phase = "sold";
}
function startReveal(r) {
  const [a, b] = r.rg[r.R];
  r.rl = []; for (let k = a; k < b; k++) r.rl.push(k);
  r.rev = 0; r.shown = false; r.phase = "reveal";
}
const buyerOf = (r, k) => { for (const p of r.players) { const w = p.won.find((x) => x.idx === k); if (w) return { p, w }; } return null; };
function doReveal(r) {
  const k = r.rl[r.rev], it = r.flat[k], b = buyerOf(r, k);
  r.shown = true;
  if (b) b.p.money += it.value;
  release(r, it.uid + ":2");
}
function settle(r) {
  const ds = r.players.filter((p) => p.loan > 0);
  if (!ds.length) return endRound(r);
  r.settleRows = ds.map((p) => {
    const interest = Math.round(p.loan * r.rate / 100), pay = p.loan + interest;
    p.money -= pay;
    const row = { name: p.name, loan: p.loan, interest, pay, money: p.money };
    p.loan = 0; return row;
  });
  r.phase = "settle";
}
function endRound(r) {
  if (r.R + 1 >= r.games.length) { r.phase = "end"; return; }
  r.R++; intro(r);
}
function adv(r) {
  switch (r.phase) {
    case "intro": {
      r.players.forEach((p) => (p.loan = 0));
      const L = r.R >= 2 ? (r.games[r.R].loan || 0) : 0;
      if (L > 0) { r.phase = "loan"; r.limit = L; } else startAuction(r);
      break;
    }
    case "loan": startAuction(r); break;
    case "auction": sell(r); break;
    case "sold": r.i++; if (r.i >= r.rg[r.R][1]) startReveal(r); else startAuction(r); break;
    case "reveal":
      if (!r.shown) doReveal(r);
      else { r.rev++; if (r.rev >= r.rl.length) settle(r); else r.shown = false; }
      break;
    case "settle": endRound(r); break;
  }
}
function bid(r, pid, price) {
  if (r.phase !== "auction") return "지금은 입찰할 수 없어요";
  const p = r.players.find((x) => x.id === pid);
  if (!p) return "x";
  if (r.leader === pid) return "이미 최고 입찰자예요!";
  const min = minBid(r), pr = price == null ? min : Math.round(Number(price));
  if (!Number.isFinite(pr) || pr < min) return "최소 " + nf(min) + " 이상 입찰해야 해요";
  if (pr > p.money) return "잔액이 부족해요 (잔액 " + nf(p.money) + ")";
  r.cur = pr; r.leader = pid; r.bids[pid] = pr;
  return null;
}
function loan(r, pid, amt) {
  if (r.phase !== "loan") return "x";
  const p = r.players.find((x) => x.id === pid);
  if (!p) return "x";
  const a = clamp(amt, 0, r.limit, 0);
  p.money += a - p.loan; p.loan = a;
  return null;
}
function setInc(r, v) { if (INCS.includes(v)) r.inc = v; }
function restart(r) {
  if (r.phase !== "end") return;
  r.phase = "lobby"; r.leader = null; r.bids = {}; r.last = null;
  r.players.forEach((p) => { p.money = r.budget; p.won = []; p.loan = 0; });
}
function buildResult(r) {
  const items = r.flat.map((o, k) => { const b = buyerOf(r, k); return { name: o.name, emoji: o.emoji, who: b ? b.p.name : null, price: b ? b.w.price : null, value: o.value }; });
  const worth = (p) => p.won.reduce((s, w) => s + r.flat[w.idx].value, 0);
  const rank = [...r.players].sort((a, b) => b.money - a.money).map((p) => ({ name: p.name, cash: p.money - worth(p), worth: worth(p), total: p.money, diff: p.money - r.budget }));
  return { items, rank };
}
function pub(r) {
  const o = {
    code: r.code, phase: r.phase, budget: r.budget, rate: r.rate, inc: r.inc, hostOn: r.hostOn,
    players: r.players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, money: p.money, loan: p.loan || 0, on: p.on })),
  };
  if (r.phase === "lobby") return o;
  o.nR = r.games.length; o.R = r.R; o.theme = r.games[r.R].theme; o.limit = r.limit;
  if (r.phase === "auction" || r.phase === "sold") {
    const it = r.flat[r.i];
    o.item = { uid: it.uid, name: it.name, emoji: it.emoji, start: it.start };
    o.pos = r.i - r.rg[r.R][0] + 1; o.nI = r.rg[r.R][1] - r.rg[r.R][0];
    o.cur = r.cur; o.leader = r.leader; o.bids = r.bids; o.last = r.last; o.min = minBid(r);
  }
  if (r.phase === "reveal") {
    const k = r.rl[r.rev], it = r.flat[k], b = buyerOf(r, k);
    o.item = { uid: it.uid, name: it.name, emoji: it.emoji };
    o.rpos = r.rev + 1; o.rn = r.rl.length; o.shown = r.shown;
    o.buy = b ? { pid: b.p.id, price: b.w.price } : null;
    if (r.shown) o.value = it.value;
  }
  if (r.phase === "settle") o.settle = r.settleRows;
  if (r.phase === "end") o.result = buildResult(r);
  return o;
}
module.exports = { createRoom, cfgOf, setConfig, setImg, join, start, adv, bid, loan, setInc, restart, pub, release };
