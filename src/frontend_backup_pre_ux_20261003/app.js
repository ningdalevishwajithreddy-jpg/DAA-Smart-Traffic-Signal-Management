/* Smart Emergency Route Planner. Plain JavaScript, Leaflet only.
   One From/To flow for both modes. Routes are drawn only after Find. */

var S = {
  mode: "demo",
  junctions: [], roads: [], byId: {},
  from: null,              // {kind:'junction',id} | {kind:'coords',lat,lng,label} | {kind:'poi',id}
  to: null,                // {kind:'junction',id} | {kind:'poi',id} | {kind:'nearest',jtype}
  activeField: "from",
  showTraffic: false,
  dataVersion: 0,          // bumped on traffic edits; steps refetch when stale
  options: [],             // nearest top-3 detail rows for cards
  routeShown: false,
  lastSteps: [], stepsKey: null,
  anim: { timers: [], idx: 0, playing: false },
  bench: {},
  map: null, offline: false,
  roadLayers: {}, markLayers: {},
  routeLayers: [],         // casing + line, removed together
  amb: null, ambTimer: null,
  real: { ok: false, summary: null, pois: [], edges: [],
    majorL: null, minorL: null, poiL: null, canvas: null,
    ambPt: null, clickPt: null,
    dest: { kind: "nearest", jtype: "hospital" } }
};

var ICON = { hospital: "🏥", fire_station: "🚒", police_station: "🚓" };
var TRAFFIC = { Clear: 1.0, Busy: 2.0, Jam: 3.0 };
// Calm, muted traffic colors (only used when the toggle is ON).
var CALM = { clear: "#86bd8a", busy: "#dfa940", jam: "#d27f7f" };
var GREY_ROAD = "#c3cad4";
var CLOSED = "#4b5563";

/* ---------- tiny helpers ---------- */

function el(id) { return document.getElementById(id); }
function showError(msg) {
  var box = el("error");
  if (!msg) { box.classList.add("hidden"); box.textContent = ""; return; }
  box.classList.remove("hidden");
  box.textContent = "⚠️ " + msg;
}
function setLoading(on) {
  el("map-loading").classList.toggle("hidden", !on);
  var b = el("find-btn");
  b.disabled = on || !(S.from && S.to);
  b.textContent = on ? "Finding…" : "Find fastest route";
}
async function api(path, options) {
  var r = await fetch(path, options);
  var data = await r.json();
  if (!r.ok) throw new Error(data.error || ("Request failed (" + r.status + ")"));
  return data;
}
function nameOf(id) {
  var j = S.byId[id];
  return j ? (j.name || id) : id;
}
function poiById(id) {
  return S.real.pois.find(function (p) { return p.id === id; });
}
function labelOf(sel) {
  if (!sel) return "";
  if (sel.kind === "junction") return nameOf(sel.id);
  if (sel.kind === "coords") return sel.label;
  if (sel.kind === "poi") { var p = poiById(sel.id); return p ? p.name : sel.id; }
  if (sel.kind === "nearest") {
    return { hospital: "Nearest hospital", fire_station: "Nearest fire station",
      police_station: "Nearest police station" }[sel.jtype] || sel.jtype;
  }
  return "";
}
// Road color: plain grey unless traffic view is ON. Closed is always dashed dark grey.
function paintFor(congestion, blocked) {
  if (blocked) return { color: CLOSED, dash: "7 5", w: 2 };
  if (!S.showTraffic) return { color: GREY_ROAD, dash: null, w: 2 };
  var c = congestion < 1.6 ? CALM.clear : congestion < 2.4 ? CALM.busy : CALM.jam;
  return { color: c, dash: null, w: 3 };
}
function profile() { return el("profile").value; }

/* ---------- init ---------- */

async function init() {
  try {
    var data = await api("/graph");
    S.junctions = data.junctions;
    S.roads = data.roads;
    S.junctions.forEach(function (j) { S.byId[j.id] = j; });
    showError(null);
  } catch (e) {
    showError("Could not load the city: " + e.message + " Is the server running?");
    return;
  }
  wireControls();
  if (typeof L === "undefined") startOffline(); else startMap();
  S.from = { kind: "junction", id: "S" }; // sensible default; user picks To
  setActiveField("to");
  renderSelection();
  if (!S.offline) { drawRoads(); renderMarkers(); }
  updateFind();
  wireModes();
  await tryRealDefault(); // real city becomes default once its data exists
}

function startMap() {
  S.map = L.map("map").setView(centerOf(), 14);
  var tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
  var fails = 0;
  tiles.on("tileerror", function () {
    if (++fails === 6) el("offline-note").classList.remove("hidden");
  });
  tiles.addTo(S.map);
  S.map.on("click", onMapClick);
}

function centerOf() {
  var lats = S.junctions.map(function (j) { return j.lat; });
  var lngs = S.junctions.map(function (j) { return j.lng; });
  return [(Math.min.apply(0, lats) + Math.max.apply(0, lats)) / 2,
          (Math.min.apply(0, lngs) + Math.max.apply(0, lngs)) / 2];
}

function startOffline() {
  // No Leaflet: notice + search/Text still work; nothing drawn.
  S.offline = true;
  el("offline-note").classList.remove("hidden");
  el("map").innerHTML = "<div style='padding:24px;color:#6b7280'>" +
    "Map unavailable offline — type in the search boxes above, then press Find.</div>";
}

/* ---------- From / To selection ---------- */

function setActiveField(which) {
  S.activeField = which;
  el("from-field").classList.toggle("active", which === "from");
  el("to-field").classList.toggle("active", which === "to");
  el("map-hint").textContent = which === "from"
    ? "Click the map to set From." : "Click the map to set To.";
}

function demoPlaces() { return S.junctions; }

function searchList(kind) {
  // What the autocomplete searches: demo junctions; real POIs (+POIs as From).
  if (S.mode === "demo") return S.junctions;
  return S.real.pois;
}

function renderSugg(kind, text) {
  var box = el(kind + "-sugg");
  var q = text.trim().toLowerCase();
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  var hits = searchList(kind).filter(function (p) {
    var nm = ((p.name || "") + " " + p.id).toLowerCase();
    return nm.indexOf(q) !== -1;
  }).slice(0, 8);
  box.innerHTML = "";
  if (!hits.length) {
    box.innerHTML = "<div class='sugg-item'>No matches. Try another name.</div>";
  }
  hits.forEach(function (p) {
    var d = document.createElement("div");
    d.className = "sugg-item";
    d.setAttribute("data-hit", "1");
    d.textContent = (ICON[p.type] ? ICON[p.type] + " " : "") + (p.name || p.id);
    d.addEventListener("mousedown", function (e) {
      e.preventDefault();
      pickSearch(kind, p);
    });
    box.appendChild(d);
  });
  box.classList.remove("hidden");
  box.firstChild.classList.add("hot");
}

function pickSearch(kind, p) {
  el(kind + "-sugg").classList.add("hidden");
  if (S.mode === "demo") {
    setField(kind, { kind: "junction", id: p.id });
  } else {
    setField(kind, kind === "from" && !p.node
      ? { kind: "coords", lat: p.lat, lng: p.lng, label: p.name || p.id }
      : { kind: "poi", id: p.id });
  }
}

function setField(kind, sel) {
  if (kind === "from") S.from = sel; else S.to = sel;
  el(kind + "-input").value = labelOf(sel);
  el(kind + "-sugg").classList.add("hidden");
  if (kind === "to") {
    document.querySelectorAll(".nearest-btns button").forEach(function (b) {
      b.classList.remove("picked");
    });
  }
  clearRouteDisplay();
  renderSelection();
  updateFind();
}

function renderSelection() {
  // Pins + active highlight; routes stay hidden until Find.
  if (!S.offline && S.map) {
    if (S.mode === "demo") renderMarkers();
    else drawRealPins();
  }
  el("swap-btn").style.display = S.mode === "demo" ? "" : "none";
}

function updateFind() {
  var b = el("find-btn"), hint = el("find-hint");
  var ok = S.from && S.to;
  b.disabled = !ok;
  b.textContent = "Find fastest route";
  hint.textContent = !S.from && !S.to ? "Choose a starting point above."
    : !S.from ? "Choose a starting point above."
    : !S.to ? "Choose a destination above."
    : "Ready — press Find.";
}

function clearAll() {
  stopAnim(); stopAmb();
  S.from = null; S.to = null;
  S.options = []; S.routeShown = false; S.lastDetail = null;
  el("from-input").value = ""; el("to-input").value = "";
  document.querySelectorAll(".nearest-btns button").forEach(function (b) {
    b.classList.remove("picked");
  });
  el("options-card").classList.add("hidden");
  el("result-card").classList.add("hidden");
  el("nearest-cards").innerHTML = "";
  clearRouteLayers();
  setActiveField("from");
  renderSelection();
  updateFind();
  showError(null);
}

/* ---------- demo map drawing (thin grey by default) ---------- */

function drawRoads() {
  Object.values(S.roadLayers).forEach(function (l) { S.map.removeLayer(l); });
  S.roadLayers = {};
  S.roads.forEach(function (road) {
    var a = S.byId[road.from], b = S.byId[road.to];
    if (!a || !b) return;
    var p = paintFor(road.congestion, road.blocked);
    var line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]],
      { color: p.color, weight: p.w, opacity: S.showTraffic ? 0.8 : 1,
        dashArray: p.dash });
    line.on("click", function () { openRoadPopup(road, line); });
    line.addTo(S.map);
    S.roadLayers[road.from + "|" + road.to] = line;
  });
}

function pinIcon(letter, cls) {
  return L.divIcon({ className: "",
    html: '<div class="pin ' + cls + '">' + letter + "</div>",
    iconSize: [30, 30], iconAnchor: [15, 15] });
}

function renderMarkers() {
  Object.values(S.markLayers).forEach(function (m) { S.map.removeLayer(m); });
  S.markLayers = {};
  S.junctions.forEach(function (j) {
    var layer;
    if (j.type === "normal") {
      layer = L.circleMarker([j.lat, j.lng],
        { radius: 7, color: "#64748b", weight: 2, fillColor: "#ffffff", fillOpacity: 1 });
    } else {
      layer = L.marker([j.lat, j.lng], { icon: L.divIcon({ className: "",
        html: '<div class="mk" data-mid="' + j.id + '">' + ICON[j.type] +
          "<small>" + j.id + "</small></div>", iconSize: [30, 34], iconAnchor: [15, 30] }) });
    }
    layer.bindTooltip(j.name || j.id);
    layer.on("click", function (e) {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      fillActiveWithJunction(j.id);
    });
    layer.addTo(S.map);
    S.markLayers[j.id] = layer;
  });
  pinLayer("from", S.from, "F", "from");
  pinLayer("to", S.to, "T", "to");
}

function pinLayer(prefix, sel, letter, cls) {
  if (!sel || sel.kind !== "junction") return;
  var j = S.byId[sel.id];
  if (!j) return;
  var m = L.marker([j.lat, j.lng], { icon: pinIcon(letter, cls), zIndexOffset: 500 });
  m.bindTooltip(labelOf(sel));
  m.addTo(S.map);
  S.markLayers[prefix + ":" + sel.id] = m;
}

function fillActiveWithJunction(id) {
  setField(S.activeField, { kind: "junction", id: id });
}

function nearestJunction(lat, lng) {
  var best = null, bestD = Infinity;
  S.junctions.forEach(function (j) {
    var d = (j.lat - lat) * (j.lat - lat) + (j.lng - lng) * (j.lng - lng);
    if (d < bestD) { bestD = d; best = j; }
  });
  return best;
}

function onMapClick(e) {
  if (S.mode === "demo") {
    var j = nearestJunction(e.latlng.lat, e.latlng.lng);
    if (j) setField(S.activeField, { kind: "junction", id: j.id });
  } else {
    if (S.activeField === "from") {
      setField("from", { kind: "coords", lat: e.latlng.lat, lng: e.latlng.lng,
        label: "Map point (" + e.latlng.lat.toFixed(4) + ", " + e.latlng.lng.toFixed(4) + ")" });
    } else {
      var p = nearestPoi(e.latlng.lat, e.latlng.lng);
      if (p) setField("to", { kind: "poi", id: p.id });
    }
  }
}

function nearestPoi(lat, lng) {
  var best = null, bestD = Infinity;
  S.real.pois.forEach(function (p) {
    var d = (p.lat - lat) * (p.lat - lat) + (p.lng - lng) * (p.lng - lng);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}

// Road popup keeps plain choices (no raw numbers for the user).
function openRoadPopup(road, line) {
  var c = S.showTraffic ? road.congestion : null;
  var status = road.blocked ? "Closed" :
    c === null ? "Traffic view is off" :
    c < 1.6 ? "Clear" : c < 2.4 ? "Busy" : "Jam";
  var html = "<b>" + nameOf(road.from) + " ↔ " + nameOf(road.to) + "</b><br>" +
    "Now: " + status + "<br><br>" +
    '<button data-a="Clear">Clear</button> <button data-a="Busy">Busy</button> ' +
    '<button data-a="Jam">Jam</button><br><br>' +
    '<button data-a="toggle">' + (road.blocked ? "Re-open road" : "Close road (accident)") + "</button>";
  line.bindPopup(html).openPopup();
  line.on("popupopen", function handler() {
    line.off("popupopen", handler);
    var gp = line.getPopup();
    if (!gp) return;
    var node = gp.getElement();
    if (!node) return;
    node.querySelectorAll("button").forEach(function (btn) {
      btn.onclick = function () { roadAction(road, btn.getAttribute("data-a")); };
    });
  });
}

async function roadAction(road, action) {
  try {
    if (action === "toggle") {
      await api("/block", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: road.from, to: road.to, blocked: !road.blocked }) });
    } else {
      await api("/congestion", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: road.from, to: road.to, congestion: TRAFFIC[action] }) });
    }
    S.map.closePopup();
    S.dataVersion++;
    var data = await api("/graph");
    S.roads = data.roads;
    drawRoads();
    if (S.routeShown && S.from && S.to) await findRoute(); // keep shown route fresh
  } catch (e) { showError(e.message); }
}

/* ---------- route: find, draw, cards ---------- */

function clearRouteLayers() {
  S.routeLayers.forEach(function (l) {
    try { (S.map || { removeLayer: function () {} }).removeLayer(l); } catch (e) {}
  });
  S.routeLayers = [];
  stopAmb();
  var R = S.real;
  if (R.routeLine && S.map && !S.offline) { try { S.map.removeLayer(R.routeLine); } catch (e) {} R.routeLine = null; }
  if (R.amb && S.map && !S.offline) { try { S.map.removeLayer(R.amb); } catch (e) {} R.amb = null; }
  if (R.ambTimer) { clearInterval(R.ambTimer); R.ambTimer = null; }
}

function stopAmb() {
  if (S.ambTimer) { clearInterval(S.ambTimer); S.ambTimer = null; }
  if (S.amb && S.map && !S.offline) { try { S.map.removeLayer(S.amb); } catch (e) {} S.amb = null; }
}

function clearRouteDisplay() {
  clearRouteLayers();
  S.routeShown = false;
  el("result-card").classList.add("hidden");
  el("options-card").classList.add("hidden");
}

function drawBlueRoute(coords) {
  // White outline under clean blue line so it stands out on any map.
  var casing = L.polyline(coords, { color: "#ffffff", weight: 9, opacity: 0.95 });
  var line = L.polyline(coords, { color: "#2563eb", weight: 5, opacity: 1 });
  casing.addTo(S.map); line.addTo(S.map);
  S.routeLayers.push(casing, line);
  S.map.fitBounds(line.getBounds().pad(0.25));
  // Moving ambulance marker.
  var pts = [];
  for (var i = 0; i < coords.length - 1; i++) {
    for (var k = 0; k < 20; k++) {
      pts.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * k / 20,
                coords[i][1] + (coords[i + 1][1] - coords[i][1]) * k / 20]);
    }
  }
  pts.push(coords[coords.length - 1]);
  S.amb = L.marker(pts[0], { icon: L.divIcon({ className: "",
    html: '<div class="amb">🚑</div>' }) }).addTo(S.map);
  var n = 0;
  S.ambTimer = setInterval(function () {
    n = (n + 1) % pts.length;
    if (S.amb) S.amb.setLatLng(pts[n]);
  }, 120);
}

// Path distance from stored road lengths (shortest leg wins on parallel roads).
function pathKm(path) {
  var total = 0;
  for (var i = 0; i < path.length - 1; i++) {
    var a = path[i], b = path[i + 1], best = Infinity;
    S.roads.forEach(function (r) {
      if ((r.from === a && r.to === b) || (r.from === b && r.to === a)) {
        if (r.length_km < best) best = r.length_km;
      }
    });
    if (best === Infinity) return null;
    total += best;
  }
  return Math.round(total * 100) / 100;
}

function busiestLink(path) {
  var best = null, bestC = -1;
  S.roads.forEach(function (x) {});
  for (var i = 0; i < path.length - 1; i++) {
    var r = S.roads.find(function (x) {
      return (x.from === path[i] && x.to === path[i + 1]) ||
             (x.from === path[i + 1] && x.to === path[i]);
    });
    if (r && r.congestion > bestC) { bestC = r.congestion; best = r; }
  }
  return best ? nameOf(best.from) + " and " + nameOf(best.to) : "some roads";
}

function showUnreachable(msg) {
  el("result-card").classList.remove("hidden");
  el("big-time").textContent = "–";
  el("result-to").textContent = msg;
  el("snap-info").textContent = "";
  el("dist-line").textContent = "";
  el("route-list").innerHTML = "";
  el("saved-line").textContent = "";
  el("fly-line").textContent = "";
  el("compare-line").textContent = "";
}

async function findRoute() {
  if (!(S.from && S.to)) { updateFind(); return; }
  stopAnim();
  setLoading(true);
  showError(null);
  try {
    if (S.mode === "demo") await findRouteDemo();
    else await findRouteReal();
  } catch (e) {
    showError(e.message);
  }
  setLoading(false);
}

async function demoPost(extra) {
  var body = Object.assign({ profile: profile(), green_corridor: true }, extra);
  return api("/route", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function findRouteDemo() {
  var source = S.from.id, data, bestRow;
  if (S.to.kind === "junction") {
    data = await demoPost({ source: source, target: S.to.id, compare_distance: true });
    bestRow = data.results.find(function (r) { return r.to === S.to.id; });
    S.options = [];
    el("options-card").classList.add("hidden");
  } else {
    var list = await demoPost({ source: source, type_filter: S.to.jtype });
    S.options = list.results.filter(function (r) { return r.time_min !== null; }).slice(0, 3);
    if (!S.options.length) {
      renderOptionCards([]);
      return showUnreachable("No open route to any " + S.to.jtype + ".");
    }
    renderOptionCards(S.options);
    data = await demoPost({ source: source, target: S.options[0].to, compare_distance: true });
    bestRow = data.results.find(function (r) { return r.to === S.options[0].to; });
  }
  if (!bestRow || bestRow.time_min === null) {
    return showUnreachable("No open route — the road may be closed.");
  }
  drawDemoDetail(data, bestRow, 0);
}

function drawDemoDetail(data, row, optIdx) {
  S.selectedOpt = optIdx;
  var coords = row.path.map(function (id) { return [S.byId[id].lat, S.byId[id].lng]; });
  if (!S.offline) {
    clearRouteLayers();
    drawBlueRoute(coords);
  }
  S.routeShown = true;
  S.lastDetail = { row: row, cmp: data.distance_comparison || null };
  el("result-card").classList.remove("hidden");
  el("big-time").textContent = row.time_min + " min";
  el("result-to").textContent = nameOf(S.from.id) + " → " + nameOf(row.to);
  el("snap-info").textContent = "";
  var km = pathKm(row.path);
  el("dist-line").textContent = km === null ? "" : km + " km by road";
  el("route-list").innerHTML = row.path.map(function (id) {
    return "<li>" + nameOf(id) + "</li>";
  }).join("");
  el("saved-line").textContent =
    "💚 Green corridor saves " + row.saved_min + " min (signals held green).";
  el("fly-line").textContent = "";
  var cmp = data.distance_comparison, line;
  if (!cmp || cmp.path.join() === row.path.join() || cmp.time_min === row.time_min) {
    line = "This is both the fastest and the shortest route right now.";
  } else {
    line = "Fastest route takes " + row.time_min + " min. The shortest-distance route (" +
      cmp.distance_km + " km) would take " + cmp.time_min +
      " min because of heavy traffic between " + busiestLink(cmp.path) + ".";
  }
  el("compare-line").textContent = line;
  markOptionCards();
}

function renderOptionCards(options) {
  var box = el("nearest-cards");
  box.innerHTML = "";
  el("options-card").classList.toggle("hidden", !options.length);
  options.forEach(function (r, i) {
    var km = pathKm(r.path);
    var d = document.createElement("div");
    d.className = "opt-card" + (i === S.selectedOpt ? " selected" : "");
    d.innerHTML = "<span class='t'>" + nameOf(r.to) + "</span>" +
      (i === 0 ? "<span class='badge'>Fastest</span>" : "") +
      "<br>" + r.time_min + " min" + (km === null ? "" : " · " + km + " km");
    d.addEventListener("click", function () { selectOption(i); });
    box.appendChild(d);
  });
}

function markOptionCards() {
  var box = el("nearest-cards").children;
  for (var i = 0; i < box.length; i++) {
    box[i].classList.toggle("selected", i === S.selectedOpt);
  }
}

async function selectOption(i) {
  // Show only that route on the map.
  if (S.mode === "demo") {
    var opt = S.options[i];
    if (!opt) return;
    setLoading(true);
    try {
      var data = await demoPost({ source: S.from.id, target: opt.to, compare_distance: true });
      var row = data.results.find(function (r) { return r.to === opt.to; });
      if (row && row.time_min !== null) drawDemoDetail(data, row, i);
    } catch (e) { showError(e.message); }
    setLoading(false);
  } else {
    var r2 = S.options[i];
    if (!r2) return;
    realDetail(r2.id);
  }
}

/* ---------- real city (same From/To flow, OSM graph) ---------- */

var MAJOR_CLASS = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1 };

function realCong(e) {
  var ps = e.profiles || {};
  return ps[profile()] !== undefined ? ps[profile()] : e.congestion;
}

async function findRouteReal() {
  var R = S.real, pt = fromLatLng();
  if (!pt) return;
  var body = { lat: pt.lat, lng: pt.lng, profile: profile(), green_corridor: true };
  if (S.to.kind === "poi") body.poi_id = S.to.id;
  else body.target_type = S.to.jtype;
  var data = await api("/real/route", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  var opts = data.results.filter(function (r) { return r.time_min !== null; }).slice(0, 3);
  S.options = opts;
  if (!opts.length) {
    renderRealCards([]);
    return showUnreachable("No open route — nearby roads may be closed.");
  }
  renderRealCards(opts);
  drawRealDetail(data, opts[0], 0, data.source.snap_km);
}

function fromLatLng() {
  if (S.from.kind === "coords") return { lat: S.from.lat, lng: S.from.lng };
  if (S.from.kind === "poi") {
    var p = poiById(S.from.id);
    return p ? { lat: p.lat, lng: p.lng } : null;
  }
  return null;
}

function renderRealCards(opts) {
  var box = el("nearest-cards");
  box.innerHTML = "";
  el("options-card").classList.toggle("hidden", !opts.length);
  opts.forEach(function (r, i) {
    var d = document.createElement("div");
    d.className = "opt-card" + (i === S.selectedOpt ? " selected" : "");
    d.innerHTML = "<span class='t'>" + r.name + "</span>" +
      (i === 0 ? "<span class='badge'>Fastest</span>" : "") +
      "<br>" + r.time_min + " min · " + r.distance_km + " km";
    d.addEventListener("click", function () { selectOption(i); });
    box.appendChild(d);
  });
}

async function realDetail(poiId) {
  var pt = fromLatLng();
  if (!pt) return;
  setLoading(true);
  try {
    var data = await api("/real/route", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: pt.lat, lng: pt.lng, poi_id: poiId,
        profile: profile(), green_corridor: true }) });
    var row = data.results[0];
    if (row && row.time_min !== null) {
      var i = S.options.findIndex(function (o) { return o.id === poiId; });
      drawRealDetail(data, row, i === -1 ? 0 : i, data.source.snap_km);
    }
  } catch (e) { showError(e.message); }
  setLoading(false);
}

function drawRealDetail(data, best, optIdx, snapKm) {
  S.selectedOpt = optIdx;
  if (!S.offline) {
    clearRouteLayers();
    var R = S.real;
    R.routeLine = L.polyline(best.geometry, { color: "#ffffff", weight: 9, opacity: 0.95 }).addTo(S.map);
    var line = L.polyline(best.geometry, { color: "#2563eb", weight: 5, opacity: 1 }).addTo(S.map);
    S.routeLayers.push(R.routeLine, line);
    R.routeLine = null; // owned by routeLayers now
    S.map.fitBounds(line.getBounds().pad(0.2));
    startAmb(best.geometry);
  }
  S.routeShown = true;
  S.lastDetail = { row: best, cmp: data.distance_comparison || null };
  el("result-card").classList.remove("hidden");
  el("big-time").textContent = best.time_min + " min";
  el("result-to").textContent = "→ " + best.name;
  el("snap-info").textContent = "Snapped " + snapKm + " km to the nearest road.";
  el("dist-line").textContent = best.distance_km + " km by road";
  el("route-list").innerHTML =
    best.road_names.map(function (n) { return "<li>" + n + "</li>"; }).join("");
  el("saved-line").textContent =
    "💚 Green corridor saves " + best.saved_min + " min (signals held green).";
  el("fly-line").textContent =
    best.flyovers.length ? "🌉 Uses flyover/bridge: " + best.flyovers.join(", ") : "";
  var cmp = data.distance_comparison, lineTxt;
  if (!cmp || cmp.time_min === best.time_min) {
    lineTxt = "This is both the fastest and the shortest route right now.";
  } else {
    lineTxt = "Fastest route takes " + best.time_min + " min (" + best.distance_km +
      " km). The shortest-distance route (" + cmp.distance_km +
      " km) would take " + cmp.time_min + " min.";
  }
  el("compare-line").textContent = lineTxt;
  markOptionCards();
}

function startAmb(geom) {
  stopAmb();
  if (S.offline || !geom || geom.length < 2) return;
  var pts = [];
  for (var i = 0; i < geom.length - 1; i++) {
    for (var k = 0; k < 12; k++) {
      pts.push([geom[i][0] + (geom[i + 1][0] - geom[i][0]) * k / 12,
                geom[i][1] + (geom[i + 1][1] - geom[i][1]) * k / 12]);
    }
  }
  pts.push(geom[geom.length - 1]);
  S.amb = L.marker(pts[0], { icon: L.divIcon({ className: "",
    html: '<div class="amb">🚑</div>' }) }).addTo(S.map);
  var n = 0;
  S.ambTimer = setInterval(function () {
    n = (n + 1) % pts.length;
    if (S.amb) S.amb.setLatLng(pts[n]);
  }, 120);
}

/* ---------- real-mode map layers (grey default, traffic on toggle) ---------- */

function realPaint(e) {
  if (e.blocked) return { color: CLOSED, dash: "7 5", w: 2 };
  if (!S.showTraffic) return { color: GREY_ROAD, dash: null, w: 2 };
  var c = realCong(e);
  return { color: c < 1.6 ? CALM.clear : c < 2.4 ? CALM.busy : CALM.jam, dash: null, w: 3 };
}

function drawRealRoads() {
  var R = S.real;
  if (!R.canvas) R.canvas = L.canvas({ padding: 0.3 });
  if (R.majorL) S.map.removeLayer(R.majorL);
  if (R.minorL) S.map.removeLayer(R.minorL);
  R.majorL = L.layerGroup(); R.minorL = L.layerGroup();
  var b = S.map.getBounds(), z = S.map.getZoom();
  var sw = b.getSouthWest(), ne = b.getNorthEast();
  var seen = {}, drawn = 0, CAP = 8000;
  for (var i = 0; i < R.edges.length && drawn < CAP; i++) {
    var e = R.edges[i];
    if (!e.geometry || e.geometry.length < 2) continue;
    if (seen[e.road_key]) continue;
    var bb = e._bb;
    if (bb && (bb[0] > ne.lat || bb[2] < sw.lat || bb[1] > ne.lng || bb[3] < sw.lng)) continue;
    var major = MAJOR_CLASS[e.road_class] ? true : false;
    if (!major && z < 15) continue;
    seen[e.road_key] = 1; drawn++;
    var grp = major ? R.majorL : R.minorL;
    var p = realPaint(e);
    if (e.bridge && S.showTraffic) {
      L.polyline(e.geometry, { renderer: R.canvas, color: "#c97b2d", weight: 7, opacity: 0.85 }).addTo(grp);
    }
    var line = L.polyline(e.geometry, { renderer: R.canvas,
      color: p.color, weight: p.w, opacity: S.showTraffic ? 0.8 : 1, dashArray: p.dash });
    line.on("click", function () { openRealRoadPopup(e); });
    line.addTo(grp);
  }
  R.majorL.addTo(S.map);
  R.minorL.addTo(S.map);
  if (R.poiL && !S.map.hasLayer(R.poiL)) S.map.addLayer(R.poiL);
}

function drawRealPins() {
  var R = S.real;
  if (R.ambPt) { try { S.map.removeLayer(R.ambPt); } catch (e) {} R.ambPt = null; }
  var pt = S.from && S.from.kind !== "junction" ? realFromLatLng() : null;
  if (pt) {
    R.ambPt = L.marker([pt.lat, pt.lng], { icon: pinIcon("F", "from"), zIndexOffset: 600 })
      .bindTooltip("From: " + labelOf(S.from)).addTo(S.map);
  }
}

function realFromLatLng() {
  if (S.from.kind === "coords") return { lat: S.from.lat, lng: S.from.lng };
  if (S.from.kind === "poi") {
    var p = poiById(S.from.id);
    return p ? { lat: p.lat, lng: p.lng } : null;
  }
  return null;
}

function drawRealPois() {
  var R = S.real;
  if (!R.poiL) R.poiL = L.layerGroup();
  R.poiL.clearLayers();
  R.pois.forEach(function (p) {
    var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "",
      html: '<div class="mk" data-mid="' + p.id + '">' + (ICON[p.type] || "📍") +
        "<small>" + p.name + "</small></div>",
      iconSize: [110, 36], iconAnchor: [55, 34] }) });
    m.bindTooltip(p.name);
    m.on("click", function (ev) {
      L.DomEvent.stopPropagation(ev);
      setField("to", { kind: "poi", id: p.id });
    });
    m.addTo(R.poiL);
  });
  if (!S.map.hasLayer(R.poiL)) S.map.addLayer(R.poiL);
}

function openRealRoadPopup(e) {
  var c = realCong(e);
  var status = e.blocked ? "Closed" :
    !S.showTraffic ? "Traffic view is off" :
    c < 1.6 ? "Clear" : c < 2.4 ? "Busy" : "Jam";
  var pop = L.popup().setLatLng(e.geometry[Math.floor(e.geometry.length / 2)])
    .setContent("<b>" + (e.name || "Unnamed road") + "</b> (" + e.road_class + ")<br>" +
      "Now: " + status + (e.bridge ? " · 🌉 flyover/bridge" : "") + "<br><br>" +
      '<button data-a="Clear">Clear</button> <button data-a="Busy">Busy</button> ' +
      '<button data-a="Jam">Jam</button><br><br>' +
      '<button data-a="toggle">' + (e.blocked ? "Re-open road" : "Close road (accident)") + "</button>")
    .openOn(S.map);
  var node = pop.getElement();
  if (!node) return;
  node.querySelectorAll("button").forEach(function (btn) {
    btn.onclick = function () { realRoadAction(e, btn.getAttribute("data-a")); };
  });
}

async function realRoadAction(e, action) {
  try {
    if (action === "toggle") {
      await api("/real/block", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ road_key: e.road_key, blocked: !e.blocked }) });
    } else {
      await api("/real/congestion", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ road_key: e.road_key, congestion: TRAFFIC[action] }) });
    }
    S.map.closePopup();
    S.dataVersion++;
    await loadRealEdges();
    if (S.routeShown && S.from && S.to) await findRoute();
  } catch (err) { showError(err.message); }
}

async function loadRealEdges() {
  var data = await api("/real/edges");
  S.real.edges = data.edges;
  S.real.edges.forEach(function (e) {
    var g = e.geometry, a = g[0][0], b = g[0][0], c = g[0][1], d = g[0][1];
    for (var i = 1; i < g.length; i++) {
      if (g[i][0] < a) a = g[i][0]; if (g[i][0] > b) b = g[i][0];
      if (g[i][1] < c) c = g[i][1]; if (g[i][1] > d) d = g[i][1];
    }
    e._bb = [a, c, b, d];
  });
  var pois = await api("/real/pois");
  S.real.pois = pois.pois;
  if (!S.offline) { drawRealRoads(); drawRealPois(); }
}

/* ---------- modes ---------- */

function wireModes() {
  el("mode-demo").addEventListener("click", function () { switchMode("demo"); });
  el("mode-real").addEventListener("click", function () { switchMode("real"); });
  el("real-bench").addEventListener("click", runRealBench);
  if (S.map && !S.offline) {
    S.map.on("click", onMapClick);
    S.map.on("zoomend", function () { if (S.mode === "real") drawRealRoads(); });
    S.map.on("moveend", function () { if (S.mode === "real") drawRealRoads(); });
  }
}

async function tryRealDefault() {
  try {
    var s = await api("/real/summary");
    S.real.ok = true;
    S.real.summary = s;
    var c = s.counts, pc = c.poi_counts || {};
    el("real-counts").textContent =
      c.nodes + " junctions, " + c.edges + " directed road pieces, " +
      (pc.hospital || 0) + " hospitals, " + (pc.fire_station || 0) +
      " fire stations, " + (pc.police_station || 0) + " police stations.";
    switchMode("real");
  } catch (e) {
    var b = el("mode-real");
    b.disabled = true;
    b.title = "Download data first: python src/data/fetch_osm.py";
  }
}

function clearModeLayers() {
  stopAnim(); stopAmb();
  if (!S.map || S.offline) return;
  Object.values(S.roadLayers).forEach(function (l) { S.map.removeLayer(l); });
  Object.values(S.markLayers).forEach(function (m) { S.map.removeLayer(m); });
  S.roadLayers = {}; S.markLayers = {};
  clearRouteLayers();
  var R = S.real;
  ["majorL", "minorL", "poiL", "ambPt"].forEach(function (k) {
    if (R[k]) { try { S.map.removeLayer(R[k]); } catch (e) {} R[k] = null; }
  });
}

async function switchMode(m) {
  if (m === "real" && !S.real.ok) { showError("Real city data is not downloaded yet."); return; }
  el("mode-demo").classList.toggle("active", m === "demo");
  el("mode-real").classList.toggle("active", m === "real");
  showError(null);
  if (S.offline && m === "real") { showError("Real city needs the online map. Staying in demo."); m = "demo"; }
  if (m === S.mode) return; // already here: keep the user's selection
  S.mode = m;
  stopAnim();
  S.from = null; S.to = null; S.options = []; S.routeShown = false;
  S.lastSteps = []; S.stepsKey = null;
  el("from-input").value = ""; el("to-input").value = "";
  el("options-card").classList.add("hidden");
  el("result-card").classList.add("hidden");
  el("swap-btn").style.display = m === "demo" ? "" : "none";
  document.querySelectorAll(".nearest-btns button").forEach(function (b) {
    b.classList.remove("picked");
  });
  clearModeLayers();
  if (m === "demo") {
    if (!S.offline) {
      S.map.setView(centerOf(), 14);
      drawRoads(); renderMarkers();
    }
    S.from = { kind: "junction", id: "S" };
    el("from-input").value = labelOf(S.from);
    setActiveField("to");
    renderSelection();
  } else {
    var ctr = S.real.summary.meta.centre;
    if (!S.offline) {
      S.map.setView([ctr.lat, ctr.lng], 13);
      if (!S.real.edges.length) await loadRealEdges();
      else { drawRealRoads(); drawRealPois(); }
    } else {
      try {
        var ed = await api("/real/edges");
        S.real.edges = ed.edges;
        var ps = await api("/real/pois");
        S.real.pois = ps.pois;
      } catch (e) { /* names unavailable offline; search limited */ }
    }
    setActiveField("from");
  }
  updateFind();
}

/* ---------- controls, tabs ---------- */

function wireControls() {
  ["from", "to"].forEach(function (kind) {
    el(kind + "-input").addEventListener("focus", function () { setActiveField(kind); });
    el(kind + "-input").addEventListener("click", function () { setActiveField(kind); });
    el(kind + "-input").addEventListener("input", function (e) {
      renderSugg(kind, e.target.value);
    });
    el(kind + "-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var item = el(kind + "-sugg").querySelector("[data-hit]");
        if (item) item.dispatchEvent(new Event("mousedown"));
      }
      if (e.key === "Escape") el(kind + "-sugg").classList.add("hidden");
    });
    el(kind + "-input").addEventListener("blur", function () {
      setTimeout(function () { el(kind + "-sugg").classList.add("hidden"); }, 180);
    });
  });
  el("swap-btn").addEventListener("click", function () {
    if (S.mode !== "demo" || !S.from || !S.to) return;
    if (S.from.kind !== "junction" || (S.to.kind !== "junction")) return;
    var f = S.from; S.from = { kind: "junction", id: S.to.id };
    S.to = { kind: "junction", id: f.id };
    el("from-input").value = labelOf(S.from);
    el("to-input").value = labelOf(S.to);
    document.querySelectorAll(".nearest-btns button").forEach(function (b) {
      b.classList.remove("picked");
    });
    clearRouteDisplay();
    renderSelection();
    updateFind();
  });
  document.querySelectorAll(".nearest-btns button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".nearest-btns button").forEach(function (b) {
        b.classList.remove("picked");
      });
      btn.classList.add("picked");
      el("to-input").value = btn.textContent.trim();
      if (S.mode === "demo") S.to = { kind: "nearest", jtype: btn.dataset.type };
      else { S.real.dest = { kind: "nearest", jtype: btn.dataset.type }; S.to = { kind: "nearest", jtype: btn.dataset.type }; }
      clearRouteDisplay();
      updateFind();
    });
  });
  el("find-btn").addEventListener("click", findRoute);
  el("clear-btn").addEventListener("click", clearAll);
  el("profile").addEventListener("change", async function () {
    S.dataVersion++;
    if (S.mode === "demo") {
      if (!S.offline) drawRoads();
      if (S.routeShown && S.from && S.to) await findRoute();
    } else {
      if (!S.offline) drawRealRoads();
      if (S.routeShown && S.from && S.to) await findRoute();
    }
  });
  el("traffic-toggle").addEventListener("click", function () {
    S.showTraffic = !S.showTraffic;
    var b = el("traffic-toggle");
    b.textContent = "Show traffic: " + (S.showTraffic ? "ON" : "OFF");
    b.setAttribute("aria-pressed", S.showTraffic ? "true" : "false");
    el("traffic-legend").classList.toggle("hidden", !S.showTraffic);
    if (!S.offline && S.map) {
      if (S.mode === "demo") drawRoads();
      else drawRealRoads();
    }
  });
  el("tab-main").addEventListener("click", function () { showTab(true); });
  el("tab-algo").addEventListener("click", function () { showTab(false); });
  el("play-btn").addEventListener("click", playSteps);
  el("pause-btn").addEventListener("click", pauseSteps);
  el("reset-btn").addEventListener("click", resetSteps);
  document.querySelectorAll("#bench-btns button").forEach(function (btn) {
    btn.addEventListener("click", function () { runBench(btn.dataset.n); });
  });
}

function showTab(main) {
  el("tab-main").classList.toggle("active", main);
  el("tab-algo").classList.toggle("active", !main);
  el("view-main").classList.toggle("hidden", !main);
  el("view-algo").classList.toggle("hidden", main);
  if (!main && S.map) setTimeout(function () { S.map.invalidateSize(); }, 50);
  else if (S.map) setTimeout(function () { S.map.invalidateSize(); }, 50);
}

/* ---------- step-by-step animation (demo city) ---------- */

function animSourceKey() {
  return S.mode + "|" + (S.from && S.from.kind === "junction" ? S.from.id : "") +
    "|" + profile() + "|" + S.dataVersion;
}

async function ensureSteps() {
  if (S.mode !== "demo" || !S.from || S.from.kind !== "junction") return false;
  if (S.lastSteps.length && S.stepsKey === animSourceKey()) return true;
  el("step-status").textContent = "Loading steps…";
  var data = await demoPost({ source: S.from.id, include_steps: true });
  S.lastSteps = data.steps || [];
  S.stepsKey = animSourceKey();
  return S.lastSteps.length > 0;
}

function nodeLayer(id) {
  return S.markLayers[id] || null;
}

function highlightNode(id, on) {
  var m = nodeLayer(id);
  if (!m) return;
  if (m.setStyle) {
    // circleMarker (ordinary junction)
    m.setStyle(on
      ? { fillColor: "#facc15", color: "#b45309", weight: 4 }
      : { fillColor: "#ffffff", color: "#64748b", weight: 2 });
  } else if (m.getElement) {
    // divIcon facility marker: toggle a gold ring on its badge
    var n = m.getElement();
    if (n && n.firstChild) n.firstChild.classList.toggle("hl", !!on);
  }
}

function clearHighlight() {
  Object.keys(S.markLayers).forEach(function (id) { highlightNode(id, false); });
}

function captionFor(i) {
  var s = S.lastSteps[i], n = S.lastSteps.length;
  var fr = (s.frontier || []).map(function (f) { return nameOf(f.id); });
  var open = fr.length > 8 ? fr.slice(0, 8).join(", ") + "… (+" + (fr.length - 8) + " more)"
    : fr.join(", ");
  return "Step " + (i + 1) + " of " + n + " — " + nameOf(s.visit) +
    " is final: fastest time " + s.time + " min." +
    (open ? " Still open: " + open + "." : " Nothing left open.");
}

function logRow(i) {
  var s = S.lastSteps[i];
  var tb = el("step-log").querySelector("tbody");
  var tr = document.createElement("tr");
  tr.id = "steplog-" + i;
  [String(i + 1), nameOf(s.visit), s.time + " min",
    String((s.frontier || []).length)].forEach(function (t) {
    var td = document.createElement("td");
    td.textContent = t;
    tr.appendChild(td);
  });
  tb.appendChild(tr);
  tr.scrollIntoView({ block: "nearest" });
}

async function playSteps() {
  if (S.mode === "real" || S.offline) {
    showError(S.offline
      ? "Animation needs the online map. Reconnect and reload the page."
      : "Step-by-step animation lives in Demo city (13 junctions). Switch to Demo city above, pick a From place, then press Play.");
    return;
  }
  if (!S.from || S.from.kind !== "junction") {
    showError("Pick a From place first (search box or map click).");
    return;
  }
  S.anim.timers.forEach(clearTimeout);
  S.anim.timers = [];
  el("pause-btn").disabled = false;
  try {
    var ok = await ensureSteps();
    if (!ok) { showError("No steps yet — press Find fastest route first."); return; }
  } catch (e) { showError(e.message); return; }
  showError(null);
  // Resume from current index (0 after Reset or a fresh load).
  if (S.anim.idx >= S.lastSteps.length) S.anim.idx = 0;
  if (S.anim.idx === 0) {
    clearHighlight();
    el("step-log").querySelector("tbody").innerHTML = "";
  }
  S.anim.playing = true;
  var speed = 1650 - parseInt(el("speed").value, 10);
  var stepMs = Math.max(120, Math.round(speed / 2.2));
  function tick() {
    if (!S.anim.playing) return;
    var i = S.anim.idx;
    if (i >= S.lastSteps.length) {
      S.anim.playing = false;
      el("pause-btn").disabled = true;
      el("step-status").textContent =
        "Done — all " + S.lastSteps.length + " places finalized. Press Reset to replay.";
      return;
    }
    highlightNode(S.lastSteps[i].visit, true);
    logRow(i);
    el("step-caption").textContent = captionFor(i);
    el("step-status").textContent =
      "Step " + (i + 1) + " of " + S.lastSteps.length;
    var rows = el("step-log").querySelectorAll("tbody tr");
    rows.forEach(function (r) { r.classList.remove("current"); });
    var cur = el("steplog-" + i);
    if (cur) cur.classList.add("current");
    S.anim.idx++;
    S.anim.timers.push(setTimeout(tick, stepMs));
  }
  tick();
}

function pauseSteps() {
  S.anim.playing = false;
  S.anim.timers.forEach(clearTimeout);
  S.anim.timers = [];
  el("pause-btn").disabled = true;
  el("step-status").textContent =
    "Paused at step " + S.anim.idx + " of " + S.lastSteps.length + ". Press Play to resume.";
}

function resetSteps() {
  stopAnim();
  S.anim.idx = 0;
  clearHighlight();
  el("step-log").querySelector("tbody").innerHTML = "";
  el("step-caption").textContent = "Press Play to start.";
  el("step-status").textContent = "";
}

function stopAnim() {
  S.anim.playing = false;
  S.anim.timers.forEach(clearTimeout);
  S.anim.timers = [];
  var pb = el("pause-btn");
  if (pb) pb.disabled = true;
}

/* ---------- benchmark (unchanged behavior) ---------- */

async function runBench(n) {
  try {
    var data = await api("/benchmark?n=" + n);
    showError(null);
    S.bench[data.n] = data;
    renderBench();
  } catch (e) { showError(e.message); }
}

function renderBench() {
  var tb = el("bench-table").querySelector("tbody");
  tb.innerHTML = "";
  Object.keys(S.bench).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
    var d = S.bench[n];
    var tr = document.createElement("tr");
    [d.n, d.heap_sec + "s", d.array_sec + "s", d.bellman_sec + "s"].forEach(function (t) {
      var td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  var keys = Object.keys(S.bench);
  if (!keys.length) return;
  var latest = S.bench[Math.max.apply(0, keys.map(Number))];
  var box = el("bench-bars");
  box.innerHTML = "";
  var max = Math.max(latest.heap_sec, latest.array_sec, latest.bellman_sec, 0.0001);
  [["heap", latest.heap_sec], ["array", latest.array_sec], ["bellman", latest.bellman_sec]].forEach(function (p) {
    var row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = "<span>n=" + latest.n + " " + p[0] + "</span>";
    var bar = document.createElement("div");
    bar.className = "bar " + p[0];
    bar.style.width = Math.max(4, Math.round(220 * p[1] / max)) + "px";
    bar.title = p[1] + "s";
    var val = document.createElement("span");
    val.textContent = p[1] + "s";
    row.appendChild(bar); row.appendChild(val);
    box.appendChild(row);
  });
}

async function runRealBench() {
  try {
    var data = await api("/real/benchmark?sources=3");
    showError(null);
    var tb = el("real-bench-table").querySelector("tbody");
    tb.innerHTML = "";
    var tr = document.createElement("tr");
    [data.nodes, data.edges, data.heap_sec + "s", data.array_sec + "s"].forEach(function (t) {
      var td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  } catch (e) { showError(e.message); }
}

init();
