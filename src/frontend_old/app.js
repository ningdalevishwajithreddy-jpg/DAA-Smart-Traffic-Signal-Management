/* Frontend logic. Plain JavaScript, no libraries.
   Talks to the FastAPI backend on the same server (works offline). */

var state = {
  junctions: [], roads: [],
  byId: {},           // id -> junction
  source: "S",
  selectedRoad: null, // {from, to}
  selectedTarget: null,
  results: [], steps: [],
  animTimer: null
};

var TYPE_COLOR = { normal: "#3b82f6", hospital: "#ef4444",
  fire_station: "#f97316", police_station: "#8b5cf6" };

// Green (congestion 1.0) -> red (3.0 or more). Returns css color.
function roadColor(congestion, blocked) {
  if (blocked) return "#9ca3af";
  var t = Math.min(Math.max((congestion - 1.0) / 2.0, 0), 1); // 0..1
  var hue = Math.round(120 - 120 * t); // 120=green .. 0=red
  return "hsl(" + hue + ",70%,45%)";
}

function showError(msg) {
  // Never go blank: errors go in the red box, layout stays.
  var box = document.getElementById("error");
  if (!msg) { box.classList.add("hidden"); box.textContent = ""; return; }
  box.classList.remove("hidden");
  box.textContent = "Error: " + msg;
}

async function api(path, options) {
  // Small wrapper: always parse JSON, throw Error with backend message.
  var r = await fetch(path, options);
  var data = await r.json();
  if (!r.ok) throw new Error(data.error || ("request failed: " + r.status));
  return data;
}

// ----- draw the map -----

function drawMap() {
  var svg = document.getElementById("map");
  svg.innerHTML = ""; // redraw everything (city is tiny)
  var NS = "http://www.w3.org/2000/svg";

  // Roads first (lines), then junctions (circles) on top.
  state.roads.forEach(function (road) {
    var a = state.byId[road.from], b = state.byId[road.to];
    if (!a || !b) return;
    // Visible line.
    var line = document.createElementNS(NS, "line");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    line.setAttribute("stroke", roadColor(road.congestion, road.blocked));
    line.setAttribute("stroke-width", "3");
    if (road.blocked) line.setAttribute("stroke-dasharray", "7 5");
    // Mark the selected road.
    if (state.selectedRoad &&
        ((state.selectedRoad.from === road.from && state.selectedRoad.to === road.to) ||
         (state.selectedRoad.from === road.to && state.selectedRoad.to === road.from))) {
      line.setAttribute("stroke-width", "6");
      line.setAttribute("stroke", "#111827");
    }
    svg.appendChild(line);
    // Invisible fat line for easy clicking.
    var hit = document.createElementNS(NS, "line");
    hit.setAttribute("x1", a.x); hit.setAttribute("y1", a.y);
    hit.setAttribute("x2", b.x); hit.setAttribute("y2", b.y);
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "16");
    hit.style.cursor = "pointer";
    hit.addEventListener("click", function (ev) {
      ev.stopPropagation();
      selectRoad(road.from, road.to);
    });
    hit.appendChild(document.createElementNS(NS, "title")).textContent =
      road.from + "-" + road.to + " congestion " + road.congestion;
    svg.appendChild(hit);
  });

  // Route highlight (thick blue) for the selected target.
  var sel = state.results.find(function (r) { return r.to === state.selectedTarget; });
  if (sel && sel.path && sel.path.length >= 2) {
    for (var i = 0; i < sel.path.length - 1; i++) {
      var u = state.byId[sel.path[i]], v = state.byId[sel.path[i + 1]];
      var rl = document.createElementNS(NS, "line");
      rl.setAttribute("x1", u.x); rl.setAttribute("y1", u.y);
      rl.setAttribute("x2", v.x); rl.setAttribute("y2", v.y);
      rl.setAttribute("stroke", "#1d4ed8");
      rl.setAttribute("stroke-width", "7");
      rl.setAttribute("opacity", "0.55");
      rl.setAttribute("pointer-events", "none");
      svg.appendChild(rl);
    }
  }

  // Junctions.
  state.junctions.forEach(function (j) {
    var g = document.createElementNS(NS, "g");
    g.style.cursor = "pointer";
    var c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", j.x); c.setAttribute("cy", j.y);
    c.setAttribute("r", j.id === state.source ? "17" : "13");
    c.setAttribute("fill", TYPE_COLOR[j.type] || "#3b82f6");
    c.setAttribute("stroke", j.id === state.source ? "#facc15" : "#1f2937");
    c.setAttribute("stroke-width", j.id === state.source ? "4" : "2");
    // Dim junctions not yet finalized during animation.
    if (state.animLeft && state.animLeft.indexOf(j.id) === -1 && j.id !== state.source) {
      c.setAttribute("opacity", "0.35");
    }
    g.appendChild(c);
    var t = document.createElementNS(NS, "text");
    t.setAttribute("x", j.x); t.setAttribute("y", j.y - 20);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "12"); t.setAttribute("font-weight", "bold");
    t.textContent = j.id;
    g.appendChild(t);
    if (j.type !== "normal") {
      var t2 = document.createElementNS(NS, "text");
      t2.setAttribute("x", j.x); t2.setAttribute("y", j.y + 28);
      t2.setAttribute("text-anchor", "middle");
      t2.setAttribute("font-size", "10"); t2.setAttribute("fill", "#555");
      t2.textContent = j.type.replace("_", " ");
      g.appendChild(t2);
    }
    g.addEventListener("click", function () { setSource(j.id); });
    svg.appendChild(g);
  });
}

// ----- route + results -----

async function refreshRoute() {
  // Ask backend for fastest times, then redraw table + map.
  stopAnimation();
  var profile = document.getElementById("profile").value || null;
  var typeSel = document.getElementById("typefilter").value || null;
  var body = { source: state.source, profile: profile,
    green_corridor: document.getElementById("green").checked,
    include_steps: true };
  if (typeSel) body.type_filter = typeSel;
  try {
    var data = await api("/route", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) });
    showError(null);
    // Important junctions first, unreachable last.
    data.results.sort(function (a, b) {
      var ai = a.type === "normal" ? 1 : 0, bi = b.type === "normal" ? 1 : 0;
      if (ai !== bi) return ai - bi;
      var at = a.time_min === null ? 1e18 : a.time_min;
      var bt = b.time_min === null ? 1e18 : b.time_min;
      return at - bt;
    });
    state.results = data.results;
    state.steps = data.steps || [];
    // Auto-select fastest important reachable junction for the blue route.
    var first = state.results.find(function (r) {
      return r.type !== "normal" && r.path.length > 0;
    });
    state.selectedTarget = first ? first.to : null;
    renderTable();
    drawMap();
  } catch (e) { showError(e.message); }
}

function renderTable() {
  var tb = document.querySelector("#results tbody");
  tb.innerHTML = "";
  state.results.forEach(function (r) {
    var tr = document.createElement("tr");
    if (r.to === state.selectedTarget) tr.className = "selected";
    if (r.time_min === null) tr.className += " unreachable";
    var cells = [r.to, r.type.replace("_", " "),
      r.time_min === null ? "unreachable" : r.time_min + " min",
      r.green_time_min === null ? "-" : r.green_time_min + " min",
      r.saved_min + " min",
      r.path.length ? r.path.join(" -> ") : "unreachable"];
    cells.forEach(function (txt) {
      var td = document.createElement("td");
      td.textContent = txt;
      tr.appendChild(td);
    });
    tr.addEventListener("click", function () {
      state.selectedTarget = r.to; // clicking a row highlights that route
      renderTable();
      drawMap();
    });
    tb.appendChild(tr);
  });
}

function setSource(id) {
  state.source = id;
  document.getElementById("source-name").textContent = id;
  refreshRoute();
}

// ----- road editing -----

function selectRoad(a, b) {
  state.selectedRoad = { from: a, to: b };
  document.getElementById("road-name").textContent = a + " - " + b;
  var road = state.roads.find(function (r) {
    return (r.from === a && r.to === b) || (r.from === b && r.to === a);
  });
  if (road) {
    document.getElementById("congestion").value = road.congestion;
    document.getElementById("cong-val").textContent = road.congestion;
    document.getElementById("block-btn").textContent =
      road.blocked ? "Open road" : "Block road";
  }
  drawMap();
}

async function refreshGraphAndRoute() {
  // After congestion/block change, update screen: reload graph, then route.
  try {
    var data = await api("/graph");
    state.junctions = data.junctions;
    state.roads = data.roads;
    state.byId = {};
    state.junctions.forEach(function (j) { state.byId[j.id] = j; });
    showError(null);
  } catch (e) { showError(e.message); return; }
  await refreshRoute();
}

// ----- step-by-step animation -----

function stopAnimation() {
  if (state.animTimer) { clearTimeout(state.animTimer); state.animTimer = null; }
  state.animLeft = null;
}

function playSteps() {
  stopAnimation();
  if (!state.steps || !state.steps.length) {
    showError("No steps returned. Try refresh first.");
    return;
  }
  showError(null);
  var order = state.steps.map(function (s) { return s.visit; });
  var speed = parseInt(document.getElementById("speed").value, 10); // ms per step
  var i = 0;
  state.animLeft = [state.source];
  (function next() {
    if (i >= order.length) { state.animLeft = null; drawMap(); return; }
    var id = order[i];
    if (state.animLeft.indexOf(id) === -1) state.animLeft.push(id);
    drawMap();
    i++;
    state.animTimer = setTimeout(next, 1510 - speed); // slider: right = faster
  })();
}

// ----- benchmark panel -----

async function runBench(n) {
  try {
    var data = await api("/benchmark?n=" + n);
    showError(null);
    var tb = document.querySelector("#bench-table tbody");
    var tr = document.createElement("tr");
    [data.n, data.heap_sec + "s", data.array_sec + "s", data.bellman_sec + "s"]
      .forEach(function (txt) {
        var td = document.createElement("td");
        td.textContent = txt;
        tr.appendChild(td);
      });
    tb.appendChild(tr);
    drawBars(data);
  } catch (e) { showError(e.message); }
}

function drawBars(data) {
  // Simple bars scaled to the slowest algorithm.
  var box = document.getElementById("bench-bars");
  box.innerHTML = "";
  var max = Math.max(data.heap_sec, data.array_sec, data.bellman_sec, 0.0001);
  [["heap", data.heap_sec], ["array", data.array_sec],
   ["bellman", data.bellman_sec]].forEach(function (pair) {
    var row = document.createElement("div");
    row.className = "bar-row";
    var label = document.createElement("span");
    label.textContent = "n=" + data.n + " " + pair[0];
    var bar = document.createElement("div");
    bar.className = "bar " + pair[0];
    bar.style.width = Math.max(4, Math.round(220 * pair[1] / max)) + "px";
    bar.title = pair[1] + "s";
    var val = document.createElement("span");
    val.textContent = pair[1] + "s";
    row.appendChild(label); row.appendChild(bar); row.appendChild(val);
    box.appendChild(row);
  });
}

// ----- wire up controls, then load -----

async function init() {
  try {
    var data = await api("/graph");
    state.junctions = data.junctions;
    state.roads = data.roads;
    state.junctions.forEach(function (j) { state.byId[j.id] = j; });
    showError(null);
  } catch (e) {
    // Layout stays; map area shows the error instead of going blank.
    showError("Could not load city map: " + e.message);
    return;
  }
  document.getElementById("congestion").addEventListener("input", function (e) {
    document.getElementById("cong-val").textContent = e.target.value;
  });
  document.getElementById("apply-cong").addEventListener("click", async function () {
    if (!state.selectedRoad) { showError("Click a road first."); return; }
    try {
      await api("/congestion", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: state.selectedRoad.from,
          to: state.selectedRoad.to,
          congestion: parseFloat(document.getElementById("congestion").value) }) });
      await refreshGraphAndRoute(); // screen updates after traffic change
    } catch (e) { showError(e.message); }
  });
  document.getElementById("block-btn").addEventListener("click", async function () {
    if (!state.selectedRoad) { showError("Click a road first."); return; }
    var road = state.roads.find(function (r) {
      return (r.from === state.selectedRoad.from && r.to === state.selectedRoad.to) ||
             (r.from === state.selectedRoad.to && r.to === state.selectedRoad.from);
    });
    try {
      var res = await api("/block", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: state.selectedRoad.from,
          to: state.selectedRoad.to, blocked: !(road && road.blocked) }) });
      document.getElementById("block-btn").textContent =
        res.blocked ? "Open road" : "Block road";
      await refreshGraphAndRoute(); // screen updates after block/open
    } catch (e) { showError(e.message); }
  });
  ["profile", "green", "typefilter"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", refreshRoute);
  });
  document.getElementById("play").addEventListener("click", playSteps);
  document.querySelectorAll("#bench-btns button").forEach(function (btn) {
    btn.addEventListener("click", function () { runBench(btn.dataset.n); });
  });
  await refreshRoute();
}

init();
