// Rate-model of a male-cns:v1.0 cell-type circuit.
// ES5 so the same file can be checked under Windows JScript.

var GOMOKU_SIZE = 15;
var GOMOKU_DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];

function flyTanh(x) {
  if (x > 20) return 1;
  if (x < -20) return -1;
  var e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
}

function onBoard(x, y) {
  return x >= 0 && y >= 0 && x < GOMOKU_SIZE && y < GOMOKU_SIZE;
}

function runScore(board, x, y, player) {
  var opponent = 3 - player;
  var total = 0;
  var openW = [0, 1, 12, 140, 1800];
  var halfW = [0, 1, 8, 80, 1100];
  var d, dx, dy, count, blocks, sign, step, nx, ny;
  for (d = 0; d < GOMOKU_DIRS.length; d++) {
    dx = GOMOKU_DIRS[d][0];
    dy = GOMOKU_DIRS[d][1];
    count = 1;
    blocks = 0;
    for (sign = 1; sign >= -1; sign -= 2) {
      step = 1;
      while (true) {
        nx = x + dx * sign * step;
        ny = y + dy * sign * step;
        if (!onBoard(nx, ny) || board[ny][nx] === opponent) {
          blocks += 1;
          break;
        }
        if (board[ny][nx] === 0) break;
        count += 1;
        step += 1;
      }
    }
    if (count >= 5) total += 100000;
    else if (blocks >= 2) continue;
    else if (blocks === 0) total += openW[count];
    else total += halfW[count];
  }
  return total;
}

function windowCounts(board, x, y, player) {
  var opponent = 3 - player;
  var twos = 0;
  var threes = 0;
  var fours = 0;
  var d, dx, dy, start, k, nx, ny, good, own, other, value, cells, c;
  for (d = 0; d < GOMOKU_DIRS.length; d++) {
    dx = GOMOKU_DIRS[d][0];
    dy = GOMOKU_DIRS[d][1];
    for (start = -4; start <= 0; start++) {
      cells = [];
      good = true;
      for (k = 0; k < 5; k++) {
        nx = x + (start + k) * dx;
        ny = y + (start + k) * dy;
        if (!onBoard(nx, ny)) {
          good = false;
          break;
        }
        cells.push([nx, ny]);
      }
      if (!good) continue;
      own = 0;
      other = 0;
      for (c = 0; c < cells.length; c++) {
        nx = cells[c][0];
        ny = cells[c][1];
        if (nx === x && ny === y) {
          own += 1;
          continue;
        }
        value = board[ny][nx];
        if (value === player) own += 1;
        else if (value === opponent) other += 1;
      }
      if (other) continue;
      if (own === 4) fours += 1;
      else if (own === 3) threes += 1;
      else if (own === 2) twos += 1;
    }
  }
  return [twos, threes, fours];
}

function centerPref(x, y) {
  var mid = (GOMOKU_SIZE - 1) / 2;
  var dx = x - mid;
  var dy = y - mid;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var diag = Math.sqrt(mid * mid + mid * mid);
  return 1 - dist / diag;
}

function adjacentCount(board, x, y, player) {
  var total = 0;
  var dy, dx, nx, ny;
  for (dy = -1; dy <= 1; dy++) {
    for (dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      nx = x + dx;
      ny = y + dy;
      if (onBoard(nx, ny) && board[ny][nx] === player) total += 1;
    }
  }
  return total;
}

function gomokuFeatures(board, x, y, player) {
  var opponent = 3 - player;
  var ownRun = runScore(board, x, y, player);
  var oppRun = runScore(board, x, y, opponent);
  var ownW = windowCounts(board, x, y, player);
  var oppW = windowCounts(board, x, y, opponent);
  return [
    Math.log(1 + ownRun) / 12,
    Math.log(1 + oppRun) / 12,
    Math.min(ownW[2], 4) / 4,
    Math.min(oppW[2], 4) / 4,
    Math.min(ownW[1], 8) / 8,
    Math.min(oppW[1], 8) / 8,
    Math.min(ownW[0], 8) / 8,
    Math.min(oppW[0], 8) / 8,
    centerPref(x, y),
    adjacentCount(board, x, y, player) / 8,
    adjacentCount(board, x, y, opponent) / 8,
    1
  ];
}

function scoreSquare(board, x, y, player) {
  var feat = gomokuFeatures(board, x, y, player);
  var neurons = CIRCUIT.neurons;
  var n = neurons.length;
  var edges = CIRCUIT.edges;
  var inputIndex = CIRCUIT.inputIndex;
  var B = CIRCUIT.B;
  var nIn = inputIndex.length;
  var nFeat = feat.length;
  var r = [];
  var u = [];
  var i, j, f, s, t, e, pre, post, w, drive, score, step;
  for (i = 0; i < n; i++) {
    r[i] = 0;
    u[i] = 0;
  }
  for (j = 0; j < nIn; j++) {
    s = 0;
    for (f = 0; f < nFeat; f++) s += feat[f] * B[f * nIn + j];
    u[inputIndex[j]] = s;
  }
  var trace = [];
  for (t = 0; t < CIRCUIT.steps; t++) {
    drive = [];
    for (i = 0; i < n; i++) drive[i] = u[i];
    for (e = 0; e < edges.length; e++) {
      pre = edges[e][0];
      post = edges[e][1];
      w = edges[e][2];
      drive[post] += w * r[pre];
    }
    for (i = 0; i < n; i++) {
      r[i] = CIRCUIT.leak * r[i] + (1 - CIRCUIT.leak) * flyTanh(drive[i]);
    }
    step = [];
    for (i = 0; i < n; i++) step[i] = r[i];
    trace.push(step);
  }
  score = CIRCUIT.bias;
  for (i = 0; i < n; i++) score += CIRCUIT.readout[i] * r[i];
  return { score: score, activity: r, trace: trace, features: feat };
}

function circuitSelfCheck() {
  var fixture = CIRCUIT.fixture;
  var result = scoreSquare(fixture.board, fixture.x, fixture.y, fixture.player);
  return Math.abs(result.score - fixture.score);
}
