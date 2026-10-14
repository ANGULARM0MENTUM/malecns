(function () {
  var N = 15;
  var HUMAN = 1;
  var FLY = 2;
  var LETTERS = "ABCDEFGHIJKLMNO";

  var boardCanvas = document.getElementById("board");
  var brainCanvas = document.getElementById("brain");
  var statusEl = document.getElementById("status");
  var activeEl = document.getElementById("active");
  var tempEl = document.getElementById("temp");
  var undoBtn = document.getElementById("undo");
  var flyEl = document.getElementById("live-fly");
  var boardCtx = boardCanvas.getContext("2d");
  var brainCtx = brainCanvas.getContext("2d");

  var board = blank();
  var moves = [];
  var hover = null;
  var busy = false;
  var over = false;
  var winCells = null;
  var activity = zeros(CIRCUIT.neurons.length);
  var hitBoxes = [];
  var hoverNeuron = -1;

  var err = circuitSelfCheck();
  if (err > 1e-4) {
    setStatus("The circuit check failed.", "Fixture error " + err.toExponential(2));
  }

  document.getElementById("counts").textContent = describeCircuit();
  var stonesEl = document.getElementById("stones");
  var PAD = 0.075;
  document.getElementById("new-game").addEventListener("click", newGame);
  undoBtn.addEventListener("click", undo);
  boardCanvas.addEventListener("click", onBoardClick);
  boardCanvas.addEventListener("mousemove", onBoardMove);
  boardCanvas.addEventListener("mouseleave", function () {
    if (!hover) return;
    hover = null;
    renderStones(false);
  });
  brainCanvas.addEventListener("mousemove", onBrainMove);
  brainCanvas.addEventListener("click", onBrainClick);
  window.addEventListener("resize", draw);
  flyHome();
  newGame();

  function blank() {
    var rows = [];
    for (var y = 0; y < N; y++) {
      var row = [];
      for (var x = 0; x < N; x++) row.push(0);
      rows.push(row);
    }
    return rows;
  }

  function zeros(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(0);
    return out;
  }

  function cloneBoard(source) {
    var copy = [];
    for (var y = 0; y < N; y++) copy.push(source[y].slice());
    return copy;
  }

  function newGame() {
    board = blank();
    moves = [];
    hover = null;
    busy = false;
    over = false;
    winCells = null;
    activity = zeros(CIRCUIT.neurons.length);
    setFlyThinking(false);
    flyHome();
    setStatus("Your move.", "Black opens on the 15×15 board.");
    draw();
  }

  function undo() {
    if (busy || moves.length === 0) return;
    over = false;
    winCells = null;
    var last = moves[moves.length - 1];
    if (last.player === FLY && moves.length >= 2) {
      popMove();
      popMove();
    } else {
      popMove();
    }
    activity = zeros(CIRCUIT.neurons.length);
    setStatus("Your move.", "Took back the last exchange.");
    renderActive([]);
    draw();
  }

  function popMove() {
    var move = moves.pop();
    board[move.y][move.x] = 0;
  }

  function nearestCell(offsetX, offsetY) {
    var width = boardCanvas.clientWidth;
    var height = boardCanvas.clientHeight;
    var gap = ((1 - 2 * PAD) * Math.min(width, height)) / (N - 1);
    var best = null;
    var bestD = gap * 0.72;
    var y, x, p, d;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        p = cellPixel(x, y, width, height);
        d = Math.sqrt((p.x - offsetX) * (p.x - offsetX) + (p.y - offsetY) * (p.y - offsetY));
        if (d < bestD) {
          bestD = d;
          best = { x: x, y: y };
        }
      }
    }
    return best;
  }

  function onBoardClick(event) {
    if (busy || over) return;
    var cell = nearestCell(event.offsetX, event.offsetY);
    if (!cell || board[cell.y][cell.x] !== 0) return;
    hover = null;
    place(cell.x, cell.y, HUMAN);
    var line = findLine(board, HUMAN);
    if (line) {
      winCells = line;
      over = true;
      setStatus("Five in a row.", "You win.");
      draw();
      return;
    }
    if (isFull()) {
      over = true;
      setStatus("The board is full.", "Draw.");
      draw();
      return;
    }
    renderStones(true);
    flyTurn();
  }

  function onBoardMove(event) {
    if (busy || over) return;
    var cell = nearestCell(event.offsetX, event.offsetY);
    var next = cell && board[cell.y][cell.x] === 0 ? cell : null;
    if (!next && !hover) return;
    if (next && hover && next.x === hover.x && next.y === hover.y) return;
    hover = next;
    renderStones(false);
  }

  function flyTurn() {
    busy = true;
    boardCanvas.classList.add("is-locked");
    setFlyThinking(true);
    setStatus("The circuit is settling.", "Eight synaptic steps across the male CNS types.");
    var ranked = rankSquares();
    var choice = choose(ranked, Number(tempEl.value));
    var frame = 0;
    var placed = false;
    var pulse = zeros(CIRCUIT.neurons.length);
    var waveSteps = 14;

    function stationOf(index) {
      var role = CIRCUIT.neurons[index].role;
      if (role === "visual") return 0.02;
      if (role === "relay") return 0.3;
      if (role === "courtship") return 0.55;
      return 0.8;
    }

    function finish() {
      if (placed) return;
      placed = true;
      place(choice.x, choice.y, FLY);
      activity = choice.activity;
      busy = false;
      boardCanvas.classList.remove("is-locked");
      setFlyThinking(false);
      renderStones(true);
      var line = findLine(board, FLY);
      if (line) {
        winCells = line;
        over = true;
        setStatus("Five in a row.", "The fly wins, at " + squareName(choice.x, choice.y) + ".");
      } else if (isFull()) {
        over = true;
        setStatus("The board is full.", "Draw.");
      } else {
        setStatus("Fly plays " + squareName(choice.x, choice.y) + ".", "Your move.");
      }
      renderActive(choice.activity);
      drawBoard();
      drawBrain(pulse);
      undoBtn.disabled = false;
      setTimeout(flyHome, 480);
    }

    function step() {
      var t = frame / (waveSteps - 1);
      var next = [];
      var i, gate;
      for (i = 0; i < choice.activity.length; i++) {
        gate = (t - stationOf(i) + 0.16) / 0.24;
        if (gate < 0) gate = 0;
        if (gate > 1) gate = 1;
        gate = gate * gate * (3 - 2 * gate);
        next[i] = choice.activity[i] * gate;
        pulse[i] = Math.abs(next[i] - activity[i]);
      }
      activity = next;
      drawBrain(pulse);
      frame += 1;
      if (frame < waveSteps) setTimeout(step, 90);
      else {
        setStatus("The fly crosses the board.", "Landing on " + squareName(choice.x, choice.y) + ".");
        flyTo(choice.x, choice.y, false);
        setTimeout(function () {
          flyTo(choice.x, choice.y, true);
          setTimeout(finish, 380);
        }, 900);
      }
    }
    step();
  }

  function place(x, y, player) {
    board[y][x] = player;
    moves.push({ x: x, y: y, player: player });
  }

  function rankSquares() {
    var ranked = [];
    var y, x, result;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        if (board[y][x] !== 0) continue;
        result = scoreSquare(board, x, y, FLY);
        ranked.push({
          x: x,
          y: y,
          score: result.score,
          activity: result.activity,
          trace: result.trace,
        });
      }
    }
    ranked.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return Math.abs(a.x - 7) + Math.abs(a.y - 7) - (Math.abs(b.x - 7) + Math.abs(b.y - 7));
    });
    return ranked;
  }

  function choose(ranked, temp) {
    if (temp <= 0.02 || ranked.length === 1) return ranked[0];
    var pool = ranked.slice(0, Math.min(8, ranked.length));
    var best = pool[0].score;
    var weights = [];
    var sum = 0;
    var i;
    for (i = 0; i < pool.length; i++) {
      weights[i] = Math.exp((pool[i].score - best) / temp);
      sum += weights[i];
    }
    var draw = Math.random() * sum;
    for (i = 0; i < pool.length; i++) {
      draw -= weights[i];
      if (draw <= 0) return pool[i];
    }
    return pool[0];
  }

  function findLine(source, player) {
    var y, x, d, k, cells, nx, ny, dx, dy;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        if (source[y][x] !== player) continue;
        for (d = 0; d < GOMOKU_DIRS.length; d++) {
          dx = GOMOKU_DIRS[d][0];
          dy = GOMOKU_DIRS[d][1];
          if (onBoard(x - dx, y - dy) && source[y - dy][x - dx] === player) continue;
          cells = [];
          for (k = 0; k < N; k++) {
            nx = x + dx * k;
            ny = y + dy * k;
            if (!onBoard(nx, ny) || source[ny][nx] !== player) break;
            cells.push([nx, ny]);
          }
          if (cells.length >= 5) return cells;
        }
      }
    }
    return null;
  }

  function isFull() {
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) if (board[y][x] === 0) return false;
    }
    return true;
  }

  function squareName(x, y) {
    return LETTERS.charAt(x) + String(y + 1);
  }

  function setFlyThinking(on) {
    if (!flyEl) return;
    if (on) flyEl.classList.add("is-thinking");
    else flyEl.classList.remove("is-thinking");
  }

  function setStatus(title, detail) {
    statusEl.innerHTML = title + "<small>" + detail + "</small>";
  }

  function cellPercent(x, y) {
    var span = 1 - 2 * PAD;
    return {
      left: (PAD + (x * span) / (N - 1)) * 100 + "%",
      top: (PAD + (y * span) / (N - 1)) * 100 + "%",
    };
  }

  function cellPixel(x, y, width, height) {
    var spanX = width * (1 - 2 * PAD);
    var spanY = height * (1 - 2 * PAD);
    return {
      x: width * PAD + (x * spanX) / (N - 1),
      y: height * PAD + (y * spanY) / (N - 1),
    };
  }

  function projectCell(x, y) {
    var marker = document.createElement("div");
    var at = cellPercent(x, y);
    marker.style.position = "absolute";
    marker.style.left = at.left;
    marker.style.top = at.top;
    marker.style.width = "0";
    marker.style.height = "0";
    marker.style.pointerEvents = "none";
    document.getElementById("board3d").appendChild(marker);
    var rect = marker.getBoundingClientRect();
    marker.parentNode.removeChild(marker);
    return rect;
  }

  function moveFly(left, top, moving) {
    var curL = flyEl.style.left.indexOf("px") === -1 ? NaN : parseFloat(flyEl.style.left);
    var curT = flyEl.style.top.indexOf("px") === -1 ? NaN : parseFloat(flyEl.style.top);
    if (!isNaN(curL) && !isNaN(curT)) {
      var dx = left - curL;
      var dy = top - curT;
      if (dx * dx + dy * dy > 36) {
        flyEl.style.setProperty("--yaw", (Math.atan2(dx, -dy) * 180 / Math.PI + 90) + "deg");
      }
    }
    flyEl.style.left = left + "px";
    flyEl.style.top = top + "px";
    if (moving) flyEl.classList.add("is-moving");
    else flyEl.classList.remove("is-moving");
  }

  function flyTo(x, y, landing) {
    var scene = document.getElementById("scene");
    if (!scene) return;
    var point = projectCell(x, y);
    var sr = scene.getBoundingClientRect();
    moveFly(point.left - sr.left, point.top - sr.top - (landing ? 4 : 28), true);
  }

  function flyHome() {
    var scene = document.getElementById("scene");
    if (!flyEl || !scene) return;
    moveFly(scene.clientWidth * 0.78, scene.clientHeight - 6, false);
    flyEl.style.setProperty("--yaw", "0deg");
  }

  function draw() {
    drawBoard();
    renderStones(false);
    drawBrain();
    undoBtn.disabled = busy || moves.length === 0;
  }

  function drawBoard() {
    var ratio = window.devicePixelRatio || 1;
    var width = boardCanvas.clientWidth || 520;
    var height = boardCanvas.clientHeight || width;
    boardCanvas.width = Math.round(width * ratio);
    boardCanvas.height = Math.round(height * ratio);
    boardCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    var shade = boardCtx.createLinearGradient(0, 0, width, height);
    shade.addColorStop(0, "#314033");
    shade.addColorStop(1, "#1b241d");
    boardCtx.fillStyle = shade;
    boardCtx.fillRect(0, 0, width, height);

    boardCtx.strokeStyle = "rgba(226, 206, 150, 0.55)";
    boardCtx.lineWidth = 1.25;
    var i, a, b;
    for (i = 0; i < N; i++) {
      a = cellPixel(0, i, width, height);
      b = cellPixel(N - 1, i, width, height);
      boardCtx.beginPath();
      boardCtx.moveTo(a.x, a.y);
      boardCtx.lineTo(b.x, b.y);
      boardCtx.stroke();
      a = cellPixel(i, 0, width, height);
      b = cellPixel(i, N - 1, width, height);
      boardCtx.beginPath();
      boardCtx.moveTo(a.x, a.y);
      boardCtx.lineTo(b.x, b.y);
      boardCtx.stroke();
    }
    boardCtx.fillStyle = "rgba(226, 182, 87, 0.9)";
    [3, 7, 11].forEach(function (s) {
      dot(cellPixel(s, s, width, height));
      if (s !== 7) {
        dot(cellPixel(s, 7, width, height));
        dot(cellPixel(7, s, width, height));
      }
    });
    if (winCells && winCells.length) {
      a = cellPixel(winCells[0][0], winCells[0][1], width, height);
      var end = winCells[winCells.length - 1];
      b = cellPixel(end[0], end[1], width, height);
      boardCtx.strokeStyle = "#f3e2b0";
      boardCtx.lineWidth = 4;
      boardCtx.lineCap = "round";
      boardCtx.beginPath();
      boardCtx.moveTo(a.x, a.y);
      boardCtx.lineTo(b.x, b.y);
      boardCtx.stroke();
    }
  }

  function dot(p) {
    boardCtx.beginPath();
    boardCtx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
    boardCtx.fill();
  }

  function renderStones(justDropped) {
    var last = moves.length ? moves[moves.length - 1] : null;
    var html = "";
    var y, x, at, kind, extra;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        if (board[y][x] === 0) continue;
        at = cellPercent(x, y);
        kind = board[y][x] === HUMAN ? "black" : "amber";
        extra = "";
        if (justDropped && last && last.x === x && last.y === y) extra += " drop";
        if (isWinCell(x, y)) extra += " win";
        html += '<div class="stone ' + kind + extra + '" style="left:' + at.left + ";top:" + at.top + '"></div>';
      }
    }
    if (hover && !busy && !over && board[hover.y][hover.x] === 0) {
      at = cellPercent(hover.x, hover.y);
      html += '<div class="stone black ghost" style="left:' + at.left + ";top:" + at.top + '"></div>';
    }
    stonesEl.innerHTML = html;
  }

  function isWinCell(x, y) {
    var i;
    if (!winCells) return false;
    for (i = 0; i < winCells.length; i++) {
      if (winCells[i][0] === x && winCells[i][1] === y) return true;
    }
    return false;
  }

  function drawBrain(pulse) {
    var ratio = window.devicePixelRatio || 1;
    var width = brainCanvas.clientWidth || 640;
    var height = 320;
    brainCanvas.width = Math.round(width * ratio);
    brainCanvas.height = Math.round(height * ratio);
    brainCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    brainCtx.clearRect(0, 0, width, height);
    var bg = brainCtx.createRadialGradient(width * 0.5, height * 0.42, 20, width * 0.5, height * 0.48, width * 0.62);
    bg.addColorStop(0, "#1c2820");
    bg.addColorStop(1, "#101510");
    brainCtx.fillStyle = bg;
    brainCtx.fillRect(0, 0, width, height);
    drawHeadSilhouette(width, height);

    var neurons = CIRCUIT.neurons;
    var edges = CIRCUIT.edges;
    var i, e, a, b, alpha, hue, level, radius, gloss;
    var slots = layoutSlots(neurons);
    var center = spot({ x: 0.5, y: 0.48 }, width, height);
    hitBoxes = [];
    for (e = 0; e < edges.length; e++) {
      if (Math.abs(edges[e][2]) < 0.045) continue;
      a = spot(slots[edges[e][0]], width, height);
      b = spot(slots[edges[e][1]], width, height);
      var fired = Math.min(1, Math.abs(activity[edges[e][0]] || 0) * 0.7 + ((pulse && pulse[edges[e][0]]) || 0) * 0.8);
      alpha = 0.03 + fired * 0.22;
      brainCtx.strokeStyle = edges[e][2] > 0
        ? "rgba(226,196,130," + alpha + ")"
        : "rgba(140,190,200," + alpha + ")";
      brainCtx.lineWidth = 0.35 + fired * 0.7;
      brainCtx.beginPath();
      brainCtx.moveTo(a.x, a.y);
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      var dx = mx - center.x;
      var dy = my - center.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      brainCtx.quadraticCurveTo(mx + (-dy / len) * 12, my + (dx / len) * 12, b.x, b.y);
      brainCtx.stroke();
    }

    for (i = 0; i < neurons.length; i++) {
      a = spot(slots[i], width, height);
      level = Math.abs(activity[i] || 0);
      var flash = Math.min(1, level * 0.75 + ((pulse && pulse[i]) || 0) * 0.9);
      radius = 1.6 + flash * 1.8;
      hue = ntColor(neurons[i].nt);
      brainCtx.shadowColor = hue;
      brainCtx.shadowBlur = flash > 0.55 ? 2 + flash * 4 : 0;
      gloss = brainCtx.createRadialGradient(a.x - radius * 0.35, a.y - radius * 0.4, radius * 0.15, a.x, a.y, radius);
      gloss.addColorStop(0, "rgba(255,255,255,0.28)");
      gloss.addColorStop(0.45, hue);
      gloss.addColorStop(1, "rgba(0,0,0,0.45)");
      brainCtx.beginPath();
      brainCtx.fillStyle = gloss;
      brainCtx.globalAlpha = 0.28 + flash * 0.32;
      brainCtx.arc(a.x, a.y, radius, 0, Math.PI * 2);
      brainCtx.fill();
      brainCtx.globalAlpha = 1;
      brainCtx.shadowBlur = 0;
      hitBoxes.push({ i: i, x: a.x, y: a.y, r: radius + 4 });
    }

    if (hoverNeuron >= 0) {
      var neuron = neurons[hoverNeuron];
      var label = neuron.name + " · " + neuron.nt + " · " + neuron.nCells + " cells";
      brainCtx.font = "12px Segoe UI, sans-serif";
      var tw = brainCtx.measureText(label).width;
      var lx = Math.min(spot(slots[hoverNeuron], width, height).x + 8, width - tw - 10);
      var ly = Math.max(16, spot(slots[hoverNeuron], width, height).y - 8);
      brainCtx.fillStyle = "rgba(12,16,12,0.88)";
      brainCtx.fillRect(lx - 4, ly - 12, tw + 8, 18);
      brainCtx.fillStyle = "#f3f6ee";
      brainCtx.fillText(label, lx, ly);
    }

  }

  function drawHeadSilhouette(width, height) {
    brainCtx.save();
    brainCtx.strokeStyle = "rgba(226, 206, 160, 0.28)";
    brainCtx.lineWidth = 1.25;
    ellipse(0.24, 0.46, 0.18, 0.27, width, height);
    ellipse(0.76, 0.46, 0.18, 0.27, width, height);
    ellipse(0.5, 0.5, 0.17, 0.22, width, height);
    ellipse(0.5, 0.8, 0.1, 0.11, width, height);
    brainCtx.beginPath();
    var left = spot({ x: 0.44, y: 0.24 }, width, height);
    var tipL = spot({ x: 0.34, y: 0.06 }, width, height);
    var right = spot({ x: 0.56, y: 0.24 }, width, height);
    var tipR = spot({ x: 0.66, y: 0.06 }, width, height);
    brainCtx.moveTo(left.x, left.y);
    brainCtx.quadraticCurveTo(tipL.x, left.y, tipL.x, tipL.y);
    brainCtx.moveTo(right.x, right.y);
    brainCtx.quadraticCurveTo(tipR.x, right.y, tipR.x, tipR.y);
    brainCtx.stroke();
    brainCtx.restore();
  }

  function ellipse(cx, cy, rx, ry, width, height) {
    var c = spot({ x: cx, y: cy }, width, height);
    var r = spot({ x: cx + rx, y: cy + ry }, width, height);
    brainCtx.beginPath();
    brainCtx.ellipse(c.x, c.y, Math.abs(r.x - c.x), Math.abs(r.y - c.y), 0, 0, Math.PI * 2);
    brainCtx.stroke();
  }

  function layoutSlots(neurons) {
    var groups = { visual: [], relay: [], courtship: [], descending: [] };
    var i;
    for (i = 0; i < neurons.length; i++) groups[neurons[i].role].push(i);
    var slots = new Array(neurons.length);
    var half = Math.ceil(groups.visual.length / 2);
    pack(slots, groups.visual.slice(0, half), 0.24, 0.46, 0.15, 0.23);
    pack(slots, groups.visual.slice(half), 0.76, 0.46, 0.15, 0.23);
    var antenna = groups.relay.slice(0, Math.min(8, groups.relay.length));
    var ocelli = groups.relay.slice(antenna.length);
    var a;
    for (i = 0; i < antenna.length; i++) {
      var side = i < antenna.length / 2 ? -1 : 1;
      var t = (i % Math.ceil(antenna.length / 2)) / Math.max(1, Math.ceil(antenna.length / 2) - 1);
      slots[antenna[i]] = {
        x: 0.5 + side * (0.06 + t * 0.12),
        y: 0.22 - t * 0.15,
      };
    }
    pack(slots, ocelli, 0.5, 0.3, 0.07, 0.05);
    pack(slots, groups.courtship, 0.5, 0.5, 0.14, 0.18);
    pack(slots, groups.descending, 0.5, 0.79, 0.09, 0.09);
    for (a = 0; a < neurons.length; a++) {
      if (!slots[a]) slots[a] = { x: 0.5, y: 0.5 };
    }
    return slots;
  }

  function pack(slots, ids, cx, cy, rx, ry) {
    var n = ids.length;
    var i, ang, rad, x, y, nx, ny, guard, k;
    var placed = 0;
    k = 0;
    guard = 0;
    while (placed < n && guard < n * 50) {
      ang = k * 2.399963;
      rad = Math.sqrt((k + 0.5) / (n * 1.45));
      x = Math.cos(ang) * rad;
      y = Math.sin(ang) * rad;
      nx = x;
      ny = y;
      if (nx * nx + ny * ny <= 1) {
        slots[ids[placed]] = { x: cx + x * rx, y: cy + y * ry };
        placed += 1;
      }
      k += 1;
      guard += 1;
    }
    while (placed < n) {
      slots[ids[placed]] = { x: cx, y: cy };
      placed += 1;
    }
  }

  function spot(slot, width, height) {
    return {
      x: 16 + slot.x * (width - 32),
      y: 26 + slot.y * (height - 40),
    };
  }

  function ntColor(nt) {
    if (nt === "acetylcholine") return "#e2b657";
    if (nt === "gaba") return "#7eb8c9";
    if (nt === "glutamate") return "#8fbe6a";
    if (nt === "histamine") return "#e07a62";
    if (nt === "dopamine" || nt === "serotonin" || nt === "octopamine" || nt === "tyramine") {
      return "#c58bd4";
    }
    return "#9aa394";
  }

  function onBrainMove(event) {
    var rect = brainCanvas.getBoundingClientRect();
    var x = ((event.clientX - rect.left) / rect.width) * (brainCanvas.clientWidth || 640);
    var y = ((event.clientY - rect.top) / rect.height) * (brainCanvas.clientHeight || 320);
    var found = -1;
    var best = 1e9;
    for (var i = 0; i < hitBoxes.length; i++) {
      var dx = hitBoxes[i].x - x;
      var dy = hitBoxes[i].y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 < hitBoxes[i].r * hitBoxes[i].r && d2 < best) {
        best = d2;
        found = hitBoxes[i].i;
      }
    }
    if (found !== hoverNeuron) {
      hoverNeuron = found;
      brainCanvas.style.cursor = found >= 0 ? "pointer" : "default";
      drawBrain();
    }
  }

  function onBrainClick() {
    if (hoverNeuron < 0) return;
    window.open(CIRCUIT.neurons[hoverNeuron].href, "_blank", "noopener");
  }

  function renderActive(values) {
    var rows = [];
    var i;
    for (i = 0; i < values.length; i++) rows.push({ i: i, a: values[i] });
    rows.sort(function (p, q) { return Math.abs(q.a) - Math.abs(p.a); });
    activeEl.innerHTML = "";
    for (i = 0; i < 5 && i < rows.length; i++) {
      var neuron = CIRCUIT.neurons[rows[i].i];
      var li = document.createElement("li");
      li.innerHTML = "<b>" + neuron.name + "</b> " + neuron.role + " · " +
        (rows[i].a >= 0 ? "+" : "") + rows[i].a.toFixed(2);
      activeEl.appendChild(li);
    }
  }

  function describeCircuit() {
    var neurons = CIRCUIT.neurons;
    var cells = 0;
    var i;
    for (i = 0; i < neurons.length; i++) cells += neurons[i].nCells;
    return neurons.length + " cell types, " + cells.toLocaleString() +
      " neurons in those types, " + CIRCUIT.edges.length.toLocaleString() +
      " signed synapses kept inside the circuit.";
  }
})();
