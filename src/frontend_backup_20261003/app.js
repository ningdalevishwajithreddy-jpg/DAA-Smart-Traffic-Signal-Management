/* Emergency Route Finder. Plain JavaScript, only Leaflet from CDN.
   If Leaflet/tiles fail (offline), a simple fallback map is drawn instead. */

var state = {
  junctions: [], roads: [], byId: {},
  source: "S",
  dest: { kind: "nearest", jtype: "hospital" }, // or {kind:"one", id:"H1"}
  lastSteps: [], routeCoords: [],
  map: null, roadLayers: {}, markLayers: {}, routeLine: null, amb: null,
  ambTimer: null, animTimers: [], bench: {}, offline: false
};

var ICON = { hospital: "🏥", fire_station: "🚒", police_station: "🚓" };
// Plain choices map to congestion numbers the backend understands.
var TRAFFIC = { Clear: 1.0, Busy: 2.0, Jam: 3.0 };

function showError(msg) {
  var box = document.getElementById("error"); // never a blank page
  if (!msg) { box.classList.add("hidden"); box.textContent = ""; return; }
  box.classList.remove("hidden");
  box.textContent = "⚠️ " + msg;
}

async function api(path, options) {
  var r = await fetch(path, options);
  var data = await r.json();
  if (!r.ok) throw new Error(data.error || ("Request failed (" + r.status + ")"));
  return data;
}

function nameOf(id) {
  var j = state.byId[id];
  return j ? (j.name || id) : id;
}

// Green < 1.6, yellow < 2.4, red otherwise. Closed roads are grey dashed.
function roadColor(road) {
  if (road.blocked) return "#9ca3af";
  if (road.congestion < 1.6) return "#22c55e";
  if (road.congestion < 2.4) return "#eab308";
  return "#ef4444";
}

/* ---------- load city, fill dropdowns ---------- */

function fillDropdowns() {
  var s = document.getElementById("source-select");
  var d = document.getElementById("dest-select");
  s.innerHTML = ""; d.innerHTML = '<option value="">Any place…</option>';
  state.junctions.forEach(function (j) {
    var t = document.createElement("option");
    t.value = j.id; t.textContent = j.id + " — " + (j.name || "");
    if (j.id === state.source) t.selected = true;
    s.appendChild(t);
    var t2 = document.createElement("option");
    t2.value = j.id; t2.textContent = j.id + " — " + (j.name || "");
    d.appendChild(t2);
  });
}

async function init() {
  try {
    var data = await api("/graph");
    state.junctions = data.junctions;
    state.roads = data.roads;
    state.junctions.forEach(function (j) { state.byId[j.id] = j; });
    showError(null);
  } catch (e) {
    showError("Could not load the city: " + e.message + " Is the server running?");
    return;
  }
  fillDropdowns();
  wireControls();
  if (typeof L === "undefined") startOffline(); else startMap();
  await loadRoute(); // show an answer immediately
  wireModes();
  await tryRealDefault(); // real city becomes the default once its data exists
}

/* ---------- Leaflet map ---------- */

function centerOf() {
  var lats = state.junctions.map(function (j) { return j.lat; });
  var lngs = state.junctions.map(function (j) { return j.lng; });
  return [(Math.min.apply(0, lats) + Math.max.apply(0, lats)) / 2,
          (Math.min.apply(0, lngs) + Math.max.apply(0, lngs)) / 2];
}

function startMap() {
  state.map = L.map("map").setView(centerOf(), 14);
  var tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
  var fails = 0;
  tiles.on("tileerror", function () {
    if (++fails === 6) goOfflineNotice(); // tiles blocked: keep working
  });
  tiles.addTo(state.map);
  drawRoads();
  drawMarkers();
}

function goOfflineNotice() {
  document.getElementById("offline-note").classList.remove("hidden");
}

function drawRoads() {
  Object.values(state.roadLayers).forEach(function (l) { state.map.removeLayer(l); });
  state.roadLayers = {};
  state.roads.forEach(function (road) {
    var a = state.byId[road.from], b = state.byId[road.to];
    var line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]],
      { color: roadColor(road), weight: 6, opacity: 0.85,
        dashArray: road.blocked ? "8 6" : null });
    line.on("click", function () { openRoadPopup(road, line); });
    line.addTo(state.map);
    state.roadLayers[road.from + "|" + road.to] = line;
  });
}

function drawMarkers() {
  Object.values(state.markLayers).forEach(function (m) { state.map.removeLayer(m); });
  state.markLayers = {};
  state.junctions.forEach(function (j) {
    var layer;
    if (j.type === "normal") {
      layer = L.circleMarker([j.lat, j.lng],
        { radius: j.id === state.source ? 11 : 8, color: "#1f2937",
          weight: 2, fillColor: j.id === state.source ? "#facc15" : "#3b82f6",
          fillOpacity: 1 });
    } else {
      layer = L.marker([j.lat, j.lng], { icon: L.divIcon({
        className: "", html: '<div class="mk">' + ICON[j.type] +
          "<small>" + j.id + "</small></div>", iconSize: [30, 34], iconAnchor: [15, 30] }) });
    }
    layer.bindTooltip(j.name || j.id);
    layer.on("click", function () { setSource(j.id); });
    layer.addTo(state.map);
    state.markLayers[j.id] = layer;
  });
}

// Small popup with plain choices (no raw numbers for the user).
function openRoadPopup(road, line) {
  var status = road.blocked ? "Closed" :
    road.congestion < 1.6 ? "Clear" : road.congestion < 2.4 ? "Busy" : "Jam";
  var html = "<b>" + nameOf(road.from) + " ↔ " + nameOf(road.to) + "</b><br>" +
    "Now: " + status + " (" + road.congestion.toFixed(1) + " km: " + road.length_km + ")<br><br>" +
    '<button data-a="Clear">Clear</button> <button data-a="Busy">Busy</button> ' +
    '<button data-a="Jam">Jam</button><br><br>' +
    '<button data-a="toggle">' + (road.blocked ? "Re-open road" : "Close road (accident)") + "</button>";
  line.bindPopup(html).openPopup();
  line.on("popupopen", function handler() {
    line.off("popupopen", handler);
    var el = line.getPopup().getElement();
    el.querySelectorAll("button").forEach(function (btn) {
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
    state.map.closePopup();
    await refreshData(); // reload map colors, then recompute the route
  } catch (e) { showError(e.message); }
}

async function refreshData() {
  var data = await api("/graph");
  state.roads = data.roads;
  drawRoads();
  await loadRoute();
}

/* ---------- offline fallback (no Leaflet): plain clickable map ---------- */

function startOffline() {
  state.offline = true;
  goOfflineNotice();
  var el = document.getElementById("map");
  var lats = state.junctions.map(function (j) { return j.lat; });
  var lngs = state.junctions.map(function (j) { return j.lng; });
  var loLa = Math.min.apply(0, lats), hiLa = Math.max.apply(0, lats);
  var loLn = Math.min.apply(0, lngs), hiLn = Math.max.apply(0, lngs);
  function px(j) {
    return [8 + 84 * (j.lng - loLn) / (hiLn - loLn || 1),
            8 + 84 * (hiLa - j.lat) / (hiLa - loLa || 1)];
  }
  var NS = "http://www.w3.org/2000/svg", pad = {};
  state.junctions.forEach(function (j) { pad[j.id] = px(j); });
  var h = '<svg viewBox="0 0 100 100" style="width:100%;height:100%">';
  state.roads.forEach(function (r) {
    var a = pad[r.from], b = pad[r.to];
    h += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] +
      '" stroke="' + roadColor(r) + '" stroke-width="1.6"/>';
  });
  if (state.routeCoords.length) {
    h += '<polyline points="' + state.routeCoords.map(function (p) {
      return p[0] + "," + p[1];
    }).join(" ") + '" fill="none" stroke="#1d4ed8" stroke-width="3"/>';
  }
  state.junctions.forEach(function (j) {
    var p = pad[j.id], e = ICON[j.type] || "🔵";
    h += '<g data-id="' + j.id + '" style="cursor:pointer">' +
      '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#fff" stroke="#1f2937"/>' +
      '<text x="' + p[0] + '" y="' + (p[1] - 5) + '" font-size="4.5" text-anchor="middle">' +
      e + " " + j.id + "</text></g>";
  });
  el.innerHTML = h + "</svg>";
  el.querySelectorAll("g[data-id]").forEach(function (g) {
    g.addEventListener("click", function () { setSource(g.getAttribute("data-id")); });
  });
}

/* ---------- route: 3-step flow ---------- */

function setSource(id) {
  state.source = id;
  document.getElementById("source-select").value = id;
  if (!state.offline) drawMarkers();
  loadRoute();
}

function profile() { return document.getElementById("profile").value; }

async function loadRoute() {
  stopAmb();
  var destSel = document.getElementById("dest-select").value;
  var body = { source: state.source, profile: profile(), green_corridor: true };
  try {
    var target = destSel || null;
    if (!target) {
      // Step 2 big button: nearest of that type (backend sorts fastest first).
      var first = await api("/route", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ type_filter: state.dest.jtype }, body)) });
      var hit = first.results.find(function (r) { return r.path.length > 0; });
      if (!hit) return showUnreachable("No open route to any " + state.dest.jtype + ".");
      target = hit.to;
    }
    var data = await api("/route", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign(
        { target: target, compare_distance: true, include_steps: true }, body)) });
    showError(null);
    state.lastSteps = data.steps || [];
    renderCard(data, target);
    drawRoute(data, target);
  } catch (e) { showError(e.message); }
}

function showUnreachable(msg) {
  document.getElementById("big-time").textContent = "–";
  document.getElementById("result-to").textContent = msg;
  document.getElementById("route-list").innerHTML = "";
  document.getElementById("saved-line").textContent = "";
  document.getElementById("compare-line").textContent = "";
}

function renderCard(data, target) {
  var row = data.results.find(function (r) { return r.to === target; });
  if (!row || row.time_min === null) return showUnreachable("No open route — the road may be closed.");
  document.getElementById("big-time").textContent = row.time_min + " min";
  document.getElementById("result-to").textContent =
    "Ambulance at " + nameOf(state.source) + " → " + nameOf(target);
  document.getElementById("route-list").innerHTML = row.path.map(function (id) {
    return "<li>" + nameOf(id) + "</li>";
  }).join("");
  document.getElementById("saved-line").textContent =
    "💚 Green corridor saves " + row.saved_min + " min (signals held green).";
  // Plain-language fastest vs shortest line.
  var cmp = data.distance_comparison, line = "";
  if (!cmp || cmp.path.join() === row.path.join() || cmp.time_min === row.time_min) {
    line = "This is both the fastest and the shortest route right now.";
  } else {
    line = "Fastest route takes " + row.time_min + " min. The shortest-distance route (" +
      cmp.distance_km + " km) would take " + cmp.time_min +
      " min because of heavy traffic between " + busiestLink(cmp.path) + ".";
  }
  document.getElementById("compare-line").textContent = line;
}

// Busiest segment (by current congestion) on the distance-shortest path.
function busiestLink(path) {
  var best = null, bestC = -1;
  for (var i = 0; i < path.length - 1; i++) {
    var r = state.roads.find(function (x) {
      return (x.from === path[i] && x.to === path[i + 1]) ||
             (x.from === path[i + 1] && x.to === path[i]);
    });
    if (r && r.congestion > bestC) { bestC = r.congestion; best = r; }
  }
  return best ? nameOf(best.from) + " and " + nameOf(best.to) : "some roads";
}

/* ---------- draw route + moving ambulance ---------- */

function stopAmb() {
  if (state.ambTimer) { clearInterval(state.ambTimer); state.ambTimer = null; }
}

function drawRoute(data, target) {
  var row = data.results.find(function (r) { return r.to === target; });
  if (!row || !row.path.length) return;
  var coords = row.path.map(function (id) { return [state.byId[id].lat, state.byId[id].lng]; });
  if (state.offline) { // static blue line in fallback map
    state.routeCoords = [];
    var lats = state.junctions.map(function (j) { return j.lat; });
    var lngs = state.junctions.map(function (j) { return j.lng; });
    var loLa = Math.min.apply(0, lats), hiLa = Math.max.apply(0, lats);
    var loLn = Math.min.apply(0, lngs), hiLn = Math.max.apply(0, lngs);
    row.path.forEach(function (id) {
      var j = state.byId[id];
      state.routeCoords.push([8 + 84 * (j.lng - loLn) / (hiLn - loLn || 1),
                              8 + 84 * (hiLa - j.lat) / (hiLa - loLa || 1)]);
    });
    return startOffline();
  }
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  if (state.amb) state.map.removeLayer(state.amb);
  state.routeLine = L.polyline(coords, { color: "#1d4ed8", weight: 8, opacity: 0.75 }).addTo(state.map);
  state.map.fitBounds(state.routeLine.getBounds().pad(0.25));
  // Moving ambulance marker along the route.
  var pts = [];
  for (var i = 0; i < coords.length - 1; i++) {
    for (var k = 0; k < 20; k++) {
      pts.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * k / 20,
                coords[i][1] + (coords[i + 1][1] - coords[i][1]) * k / 20]);
    }
  }
  pts.push(coords[coords.length - 1]);
  state.amb = L.marker(pts[0], { icon: L.divIcon({ className: "", html: '<div class="amb">🚑</div>' }) }).addTo(state.map);
  var n = 0;
  state.ambTimer = setInterval(function () {
    n = (n + 1) % pts.length;
    state.amb.setLatLng(pts[n]);
  }, 120);
}

/* ---------- controls, tabs, algorithm view ---------- */

function wireControls() {
  document.getElementById("source-select").addEventListener("change", function (e) {
    setSource(e.target.value);
  });
  document.querySelectorAll(".big-btns button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".big-btns button").forEach(function (b) { b.classList.remove("picked"); });
      btn.classList.add("picked");
      document.getElementById("dest-select").value = "";
      if (state.mode === "real") { realDestButton(btn.dataset.type); return; }
      state.dest = { kind: "nearest", jtype: btn.dataset.type };
      loadRoute();
    });
  });
  document.querySelector(".big-btns button").classList.add("picked");
  document.getElementById("dest-select").addEventListener("change", function (e) {
    document.querySelectorAll(".big-btns button").forEach(function (b) { b.classList.remove("picked"); });
    if (state.mode === "real") { realDestPicked(e.target.value); return; }
    if (e.target.value) state.dest = { kind: "one", id: e.target.value };
    loadRoute();
  });
  document.getElementById("profile").addEventListener("change", function () {
    if (state.mode === "real") realControlChanged(); else loadRoute();
  });
  document.getElementById("tab-main").addEventListener("click", function () { showTab(true); });
  document.getElementById("tab-algo").addEventListener("click", function () { showTab(false); });
  document.getElementById("play").addEventListener("click", playSteps);
  document.querySelectorAll("#bench-btns button").forEach(function (btn) {
    btn.addEventListener("click", function () { runBench(btn.dataset.n); });
  });
}

function showTab(main) {
  document.getElementById("tab-main").classList.toggle("active", main);
  document.getElementById("tab-algo").classList.toggle("active", !main);
  document.getElementById("view-main").classList.toggle("hidden", !main);
  document.getElementById("view-algo").classList.toggle("hidden", main);
}

// Step animation: flash each finalized place, quickest first.
function playSteps() {
  state.animTimers.forEach(clearTimeout);
  state.animTimers = [];
  if (state.mode === "real") {
    showError("Step-by-step animation lives in Demo city (13 junctions). " +
      "Switch to Demo city above, pick a source, then press Play.");
    return;
  }  if (!state.lastSteps.length) { showError("No steps yet — load a route first."); return; }
  showError(null);
  if (state.offline) { document.getElementById("step-status").textContent = "Animation needs the online map."; return; }
  var speed = 1500 - parseInt(document.getElementById("speed").value, 10);
  state.lastSteps.forEach(function (s, i) {
    state.animTimers.push(setTimeout(function () {
      var m = state.markLayers[s.visit];
      if (m && m.setStyle) m.setStyle({ fillColor: "#facc15", color: "#b45309" });
      document.getElementById("step-status").textContent =
        "Finalized " + (i + 1) + " of " + state.lastSteps.length + ": " + nameOf(s.visit);
      if (i === state.lastSteps.length - 1) {
        state.animTimers.push(setTimeout(drawMarkers, speed)); // restore colors
      }
    }, i * Math.max(80, speed / 3)));
  });
}

// Benchmark: ONE row per size, sorted by n, replaced on re-run.
async function runBench(n) {
  try {
    var data = await api("/benchmark?n=" + n);
    showError(null);
    state.bench[data.n] = data;
    renderBench();
  } catch (e) { showError(e.message); }
}

function renderBench() {
  var tb = document.querySelector("#bench-table tbody");
  tb.innerHTML = "";
  Object.keys(state.bench).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
    var d = state.bench[n];
    var tr = document.createElement("tr");
    [d.n, d.heap_sec + "s", d.array_sec + "s", d.bellman_sec + "s"].forEach(function (t) {
      var td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  var keys = Object.keys(state.bench);
  if (!keys.length) return;
  var latest = state.bench[Math.max.apply(0, keys.map(Number))];
  var box = document.getElementById("bench-bars");
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

init();

/* ================= REAL CITY MODE (Jagadgirigutta OSM graph) ================= */

state.mode = "demo";
state.real = { ok: false, summary: null, pois: [], edges: [],
  majorL: null, minorL: null, poiL: null, routeLine: null, amb: null,
  ambTimer: null, clickPt: null, ambPt: null,
  dest: { kind: "nearest", jtype: "hospital" }, canvas: null };
var MAJOR_CLASS = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1 };

function realCong(e) {
  var ps = e.profiles || {};
  return ps[profile()] !== undefined ? ps[profile()] : e.congestion;
}
function realColor(c, blocked) {
  if (blocked) return "#9ca3af";
  if (c < 1.6) return "#22c55e";
  if (c < 2.4) return "#eab308";
  return "#ef4444";
}

function wireModes() {
  document.getElementById("mode-demo").addEventListener("click", function () { switchMode("demo"); });
  document.getElementById("mode-real").addEventListener("click", function () { switchMode("real"); });
  document.getElementById("real-bench").addEventListener("click", runRealBench);
  if (state.map && !state.offline) {
    state.map.on("click", function (e) {
      if (state.mode !== "real") return;
      setRealAmbulance(e.latlng.lat, e.latlng.lng);
    });
    state.map.on("zoomend", function () {
      if (state.mode === "real") drawRealRoads();
    });
    state.map.on("moveend", function () {
      if (state.mode === "real") drawRealRoads(); // lanes for the new view
    });
  }
}

async function tryRealDefault() {
  try {
    var s = await api("/real/summary");
    state.real.ok = true;
    state.real.summary = s;
    var c = s.counts, pc = c.poi_counts || {};
    document.getElementById("real-counts").textContent =
      c.nodes + " junctions, " + c.edges + " directed road pieces, " +
      (pc.hospital || 0) + " hospitals, " + (pc.fire_station || 0) +
      " fire stations, " + (pc.police_station || 0) + " police stations.";
    switchMode("real"); // default once the data works
  } catch (e) {
    var b = document.getElementById("mode-real");
    b.disabled = true;
    b.title = "Download data first: python src/data/fetch_osm.py";
  }
}

function clearDemoLayers() {
  stopAmb();
  Object.values(state.roadLayers).forEach(function (l) { state.map.removeLayer(l); });
  Object.values(state.markLayers).forEach(function (m) { state.map.removeLayer(m); });
  state.roadLayers = {}; state.markLayers = {};
  if (state.routeLine) { state.map.removeLayer(state.routeLine); state.routeLine = null; }
  if (state.amb) { state.map.removeLayer(state.amb); state.amb = null; }
}

function clearRealLayers() {
  var R = state.real;
  if (R.ambTimer) { clearInterval(R.ambTimer); R.ambTimer = null; }
  ["majorL", "minorL", "poiL", "routeLine", "amb", "ambPt"].forEach(function (k) {
    if (R[k]) { state.map.removeLayer(R[k]); R[k] = null; }
  });
}

async function switchMode(m) {
  if (m === "real" && !state.real.ok) { showError("Real city data is not downloaded yet."); return; }
  document.getElementById("mode-demo").classList.toggle("active", m === "demo");
  document.getElementById("mode-real").classList.toggle("active", m === "real");
  document.getElementById("source-select").classList.toggle("hidden", m === "real");
  document.getElementById("src-real-hint").classList.toggle("hidden", m !== "real");
  showError(null);
  if (state.offline) { showError("Real city needs the online map. Showing demo."); m = "demo"; }
  if (m === state.mode && m === "demo") { loadRoute(); return; }
  state.mode = m;
  if (m === "demo") {
    clearRealLayers();
    state.map.setView(centerOf(), 14);
    fillDropdowns();
    drawRoads(); drawMarkers();
    await loadRoute();
  } else {
    clearDemoLayers();
    var ctr = state.real.summary.meta.centre;
    state.map.setView([ctr.lat, ctr.lng], 13);
    fillRealDest();
    if (!state.real.edges.length) await loadRealEdges(); // fetched once
    else { drawRealRoads(); drawRealPois(); }
    // Start at the first hospital so the screen answers in 10 seconds.
    var h = state.real.pois.find(function (p) { return p.type === "hospital"; });
    var start = h ? [h.lat, h.lng] : [ctr.lat, ctr.lng];
    setRealAmbulance(start[0] - 0.01, start[1] - 0.01);
  }
}

function fillRealDest() {
  var d = document.getElementById("dest-select");
  d.innerHTML = '<option value="">Nearest place (use the big buttons)…</option>';
  state.real.pois.forEach(function (p) {
    var o = document.createElement("option");
    o.value = p.id;
    o.textContent = (ICON[p.type] || "") + " " + p.name;
    d.appendChild(o);
  });
}

async function loadRealEdges() {
  var data = await api("/real/edges");
  state.real.edges = data.edges;
  state.real.edges.forEach(function (e) { // bbox once: fast redraws later
    var g = e.geometry, a = g[0][0], b = g[0][0], c = g[0][1], d = g[0][1];
    for (var i = 1; i < g.length; i++) {
      if (g[i][0] < a) a = g[i][0]; if (g[i][0] > b) b = g[i][0];
      if (g[i][1] < c) c = g[i][1]; if (g[i][1] > d) d = g[i][1];
    }
    e._bb = [a, c, b, d];
  });
  var pois = await api("/real/pois");
  state.real.pois = pois.pois;
  if (!state.real.poiL) state.real.poiL = L.layerGroup();
  drawRealRoads();
  drawRealPois();
}

function bbHit(bb, b) {
  // Edge bbox [minlat,minlng,maxlat,maxlng] vs Leaflet bounds. O(1) check.
  var sw = b.getSouthWest(), ne = b.getNorthEast();
  return bb[0] <= ne.lat && bb[2] >= sw.lat && bb[1] <= ne.lng && bb[3] >= sw.lng;
}

function realEdgeLayers() {
  // Draw only what is on screen: each road once, majors always,
  // small lanes only at zoom 15+. Keeps the browser fast.
  var R = state.real;
  if (!R.canvas) R.canvas = L.canvas({ padding: 0.3 });
  if (R.majorL) state.map.removeLayer(R.majorL);
  if (R.minorL) state.map.removeLayer(R.minorL);
  R.majorL = L.layerGroup(); R.minorL = L.layerGroup();
  var b = state.map.getBounds(), z = state.map.getZoom();
  var seen = {}, drawn = 0, CAP = 8000;
  for (var i = 0; i < R.edges.length && drawn < CAP; i++) {
    var e = R.edges[i];
    if (!e.geometry || e.geometry.length < 2) continue;
    if (seen[e.road_key]) continue; // two-way road drawn once
    if (!bbHit(e._bb, b)) continue; // off screen
    var major = MAJOR_CLASS[e.road_class] ? true : false;
    if (!major && z < 15) continue; // zoom in to see small lanes
    seen[e.road_key] = 1; drawn++;
    var grp = major ? R.majorL : R.minorL;
    if (e.bridge) { // flyover casing: orange outline under the traffic color
      L.polyline(e.geometry, { renderer: R.canvas, color: "#f97316", weight: 9, opacity: 0.9 }).addTo(grp);
    }
    var line = L.polyline(e.geometry, { renderer: R.canvas,
      color: realColor(realCong(e), e.blocked), weight: 5, opacity: 0.85,
      dashArray: e.blocked ? "7 5" : null });
    line.on("click", function () { openRealRoadPopup(e); });
    line.addTo(grp);
  }
  R.majorL.addTo(state.map);
  R.minorL.addTo(state.map); // empty below zoom 15, filled above
}

function drawRealRoads() {
  realEdgeLayers();
  var R = state.real;
  if (R.poiL && !state.map.hasLayer(R.poiL)) R.poiL.addTo(state.map);
}

function drawRealPois() {
  var R = state.real;
  R.poiL.clearLayers();
  R.pois.forEach(function (p) {
    var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "",
      html: '<div class="mk">' + (ICON[p.type] || "📍") + "<small>" + p.name + "</small></div>",
      iconSize: [110, 36], iconAnchor: [55, 34] }) });
    m.bindTooltip(p.name);
    m.on("click", function (ev) {
      L.DomEvent.stopPropagation(ev);
      state.real.dest = { kind: "one", id: p.id };
      document.getElementById("dest-select").value = p.id;
      realRoute();
    });
    m.addTo(R.poiL);
  });
}

function openRealRoadPopup(e) {
  var status = e.blocked ? "Closed" :
    realCong(e) < 1.6 ? "Clear" : realCong(e) < 2.4 ? "Busy" : "Jam";
  var pop = L.popup().setLatLng(e.geometry[Math.floor(e.geometry.length / 2)])
    .setContent("<b>" + (e.name || "Unnamed road") + "</b> (" + e.road_class + ")<br>" +
      "Now: " + status + (e.bridge ? " · 🌉 flyover/bridge" : "") + "<br><br>" +
      '<button data-a="Clear">Clear</button> <button data-a="Busy">Busy</button> ' +
      '<button data-a="Jam">Jam</button><br><br>' +
      '<button data-a="toggle">' + (e.blocked ? "Re-open road" : "Close road (accident)") + "</button>")
    .openOn(state.map);
  var el = pop.getElement();
  el.querySelectorAll("button").forEach(function (btn) {
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
    state.map.closePopup();
    await loadRealEdges(); // fresh colors for the selected profile
    await realRoute();
  } catch (err) { showError(err.message); }
}

function setRealAmbulance(lat, lng) {
  var R = state.real;
  if (R.ambPt) state.map.removeLayer(R.ambPt);
  R.clickPt = { lat: lat, lng: lng };
  R.ambPt = L.circleMarker([lat, lng], { radius: 9, color: "#1f2937", weight: 2, fillColor: "#facc15", fillOpacity: 1 })
    .bindTooltip("Ambulance (snaps to nearest road)").addTo(state.map);
  realRoute();
}

function realDestButton(jtype) {
  state.real.dest = { kind: "nearest", jtype: jtype };
  realRoute();
}
function realDestPicked(poiId) {
  state.real.dest = poiId ? { kind: "one", id: poiId } : state.real.dest;
  realRoute();
}
function realControlChanged() {
  drawRealRoads(); // recolor for the new profile
  realRoute();
}

async function realRoute() {
  var R = state.real;
  if (R.ambTimer) { clearInterval(R.ambTimer); R.ambTimer = null; }
  if (!R.clickPt) return;
  var body = { lat: R.clickPt.lat, lng: R.clickPt.lng,
    profile: profile(), green_corridor: true };
  if (R.dest.kind === "one") body.poi_id = R.dest.id;
  else body.target_type = R.dest.jtype;
  try {
    var data = await api("/real/route", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    showError(null);
    var best = data.results.find(function (r) { return r.time_min !== null; });
    if (!best) {
      showUnreachable("No open route — nearby roads may be closed.");
      document.getElementById("snap-info").textContent = "";
      return;
    }
    document.getElementById("big-time").textContent = best.time_min + " min";
    document.getElementById("result-to").textContent = "→ " + best.name;
    document.getElementById("snap-info").textContent =
      "Snapped " + data.source.snap_km + " km to the nearest road.";
    document.getElementById("route-list").innerHTML =
      best.road_names.map(function (n) { return "<li>" + n + "</li>"; }).join("");
    document.getElementById("saved-line").textContent =
      "💚 Green corridor saves " + best.saved_min + " min (signals held green).";
    document.getElementById("fly-line").textContent =
      best.flyovers.length ? "🌉 Uses flyover/bridge: " + best.flyovers.join(", ") : "";
    var cmp = data.distance_comparison, line;
    if (!cmp || cmp.time_min === best.time_min) {
      line = "This is both the fastest and the shortest route right now.";
    } else {
      line = "Fastest route takes " + best.time_min + " min (" + best.distance_km +
        " km). The shortest-distance route (" + cmp.distance_km +
        " km) would take " + cmp.time_min + " min.";
    }
    document.getElementById("compare-line").textContent = line;
    // Also list the next 2 nearest below the best.
    var others = data.results.filter(function (r) { return r !== best && r.time_min !== null; });
    if (others.length) {
      var ol = document.getElementById("route-list");
      others.forEach(function (r) {
        var li = document.createElement("li");
        li.className = "muted";
        li.textContent = "Also nearby: " + r.name + " (" + r.time_min + " min)";
        ol.appendChild(li);
      });
    }
    drawRealRoute(best.geometry);
  } catch (e) { showError(e.message); }
}

function drawRealRoute(geom) {
  var R = state.real;
  if (R.routeLine) state.map.removeLayer(R.routeLine);
  if (R.amb) state.map.removeLayer(R.amb);
  R.routeLine = L.polyline(geom, { color: "#1d4ed8", weight: 8, opacity: 0.8 }).addTo(state.map);
  state.map.fitBounds(R.routeLine.getBounds().pad(0.2));
  var pts = [];
  for (var i = 0; i < geom.length - 1; i++) {
    for (var k = 0; k < 8; k++) {
      pts.push([geom[i][0] + (geom[i + 1][0] - geom[i][0]) * k / 8,
                geom[i][1] + (geom[i + 1][1] - geom[i][1]) * k / 8]);
    }
  }
  pts.push(geom[geom.length - 1]);
  R.amb = L.marker(pts[0], { icon: L.divIcon({ className: "", html: '<div class="amb">🚑</div>' }) }).addTo(state.map);
  var n = 0;
  R.ambTimer = setInterval(function () {
    n = (n + 1) % pts.length;
    R.amb.setLatLng(pts[n]);
  }, 100);
}

async function runRealBench() {
  try {
    var data = await api("/real/benchmark?sources=3");
    showError(null);
    var tb = document.querySelector("#real-bench-table tbody");
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
