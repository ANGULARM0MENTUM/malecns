"""Build the Gomoku opponent from public male-cns:v1.0 cell-type connectivity.

Downloads combined cell-type pages from the Reiser lab Male CNS Cell Type
Explorer (a snapshot of neuprint male-cns:v1.0) and keeps synapses among a
visual, courtship, and descending circuit. A linear readout is then fit so
that circuit can rank Gomoku squares. Synaptic weights are not trained.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PAGES = DATA / "types"
CATALOG = DATA / "neurons.json"
BASE = "https://reiserlab.github.io/celltype-explorer-drosophila-male-cns/types/"

SIZE = 15
DIRS = ((1, 0), (0, 1), (1, 1), (1, -1))
STEPS = 8
LEAK = 0.45
SEED = 20260608

EXACT = {
    "Mi1",
    "T4a",
    "T4b",
    "T4c",
    "T4d",
    "T5a",
    "T5b",
    "T5c",
    "T5d",
    "LPLC1",
    "LPLC2",
    "LC10a",
    "LC10b",
    "LC10c-1",
    "LC10d",
    "LC11",
    "LC12",
    "aSP22",
    "pIP1",
    "pIP10",
    "pMP2",
    "vpoEN",
    "vpoIN",
    "DNg13",
    "DNg14",
    "DNg15",
}

SIGN = {
    "acetylcholine": 1.0,
    "gaba": -1.0,
    "glutamate": -1.0,
    "histamine": -1.0,
    "dopamine": 0.25,
    "serotonin": 0.25,
    "octopamine": 0.25,
    "tyramine": 0.25,
}

ROW_RE = re.compile(
    r"<tr id=[ud]\d+><td class=p-c data-body-ids=\[([0-9,]*)\]>"
    r"<a href=([^ >]+)>([^<]+)</a><td>(\d+)<td><abbr title=([A-Za-z0-9_+-]+)>[^<]*</abbr>"
    r"<td[^>]*>(?:<span title=([0-9.]+)>)?([^<]*)"
    r"<td class=(?:dg|ug)[^>]*title=([0-9.]+)%"
)
NT_RE = re.compile(
    r"class=stat-number><abbr title=([a-z0-9]+)>[^<]*</abbr>"
    r"<abbr title=\"([0-9.]+)% Confidence\""
)
N_RE = re.compile(r"class=stat-number>([0-9,]+)</div><div class=stat-label>Neurons")


def wanted(name: str) -> bool:
    if name in EXACT:
        return True
    if name.startswith("pC1") and "/" not in name:
        return True
    if name.startswith("TN1"):
        return True
    if re.fullmatch(r"DNa\d+", name):
        return True
    return False


def role_for(name: str) -> str:
    if name.startswith(("T4", "T5", "LC", "LPLC", "Mi", "Tm", "R1")):
        return "visual"
    if name.startswith("DN"):
        return "descending"
    if name.startswith(("pC1", "pIP", "pMP", "aSP", "TN", "vpo")):
        return "courtship"
    return "relay"


def curl(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 800:
        return
    subprocess.run(
        [
            "curl.exe",
            "--ssl-no-revoke",
            "-fsSL",
            "--retry",
            "4",
            "--retry-delay",
            "1",
            "-A",
            "malecns-fly-gomoku",
            "-o",
            str(dest),
            url,
        ],
        check=True,
        timeout=180,
    )


def ensure_catalog() -> dict:
    if not CATALOG.exists():
        curl(
            "https://reiserlab.github.io/celltype-explorer-drosophila-male-cns/data/neurons.json",
            CATALOG,
        )
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def download_pages(names: list[str], urls: dict[str, str]) -> None:
    jobs = []
    for name in names:
        href = urls.get(name)
        if not href:
            print("missing page", name)
            continue
        jobs.append((name, BASE + href, PAGES / href.replace("/", "_")))

    lock = threading.Lock()
    done = {"n": 0}

    def one(job):
        name, url, dest = job
        curl(url, dest)
        with lock:
            done["n"] += 1
            print(f"page {done['n']}/{len(jobs)} {name}", flush=True)
        return dest

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(one, job) for job in jobs]
        for fut in as_completed(futures):
            fut.result()


def parse_page(path: Path) -> dict:
    html = path.read_text(encoding="utf-8", errors="replace")
    nt_m = NT_RE.search(html)
    n_m = N_RE.search(html)
    nt = nt_m.group(1) if nt_m else "unknown"
    confidence = float(nt_m.group(2)) if nt_m else 0.0
    n_cells = int(n_m.group(1).replace(",", "")) if n_m else 1
    downstream = []
    upstream = []
    for match in re.finditer(r"<tr id=([ud])\d+>(.*?)(?=<tr |</tbody>)", html):
        kind, row = match.group(1), match.group(2)
        link = re.search(r"<a href=([^ >]+)>([^<]+)</a>", row)
        if not link:
            continue
        span = re.search(r"<span title=([0-9.]+)", row)
        if span:
            weight = float(span.group(1))
        else:
            bare = re.search(r">([0-9][0-9,]*(?:\.[0-9]+)?)<td class=(?:dg|ug)", row)
            weight = float(bare.group(1).replace(",", "")) if bare else 0.0
        percent_match = re.search(r"title=([0-9.]+)%", row)
        body_match = re.search(r"data-body-ids=\"?\[([0-9, ]+)\]", row)
        record = {
            "partner": link.group(2),
            "weight": weight,
            "percent": float(percent_match.group(1)) if percent_match else 0.0,
            "body": body_match.group(1).split(",")[0].strip() if body_match else "",
        }
        if kind == "d":
            downstream.append(record)
        else:
            upstream.append(record)
    return {
        "nt": nt,
        "confidence": confidence,
        "n_cells": n_cells,
        "downstream": downstream,
        "upstream": upstream,
    }


def layout(neurons: list[dict]) -> None:
    groups = {"visual": [], "relay": [], "courtship": [], "descending": []}
    for i, neuron in enumerate(neurons):
        groups[neuron["role"]].append(i)
    columns = {
        "visual": 0.16,
        "relay": 0.40,
        "courtship": 0.62,
        "descending": 0.86,
    }
    for role, idxs in groups.items():
        m = max(len(idxs), 1)
        for k, i in enumerate(idxs):
            neurons[i]["x"] = columns[role]
            neurons[i]["y"] = (k + 0.5) / m


def on_board(x: int, y: int) -> bool:
    return 0 <= x < SIZE and 0 <= y < SIZE


def run_score(board: np.ndarray, x: int, y: int, player: int) -> int:
    opponent = 3 - player
    total = 0
    open_w = (0, 1, 12, 140, 1800)
    half_w = (0, 1, 8, 80, 1100)
    for dx, dy in DIRS:
        count = 1
        blocks = 0
        for sign in (1, -1):
            step = 1
            while True:
                nx = x + dx * sign * step
                ny = y + dy * sign * step
                if not on_board(nx, ny) or board[ny, nx] == opponent:
                    blocks += 1
                    break
                if board[ny, nx] == 0:
                    break
                count += 1
                step += 1
        if count >= 5:
            total += 100000
        elif blocks >= 2 or count >= 5:
            continue
        elif blocks == 0:
            total += open_w[count]
        else:
            total += half_w[count]
    return total


def window_counts(board: np.ndarray, x: int, y: int, player: int) -> tuple[int, int, int]:
    opponent = 3 - player
    twos = threes = fours = 0
    for dx, dy in DIRS:
        for start in range(-4, 1):
            cells = []
            good = True
            for k in range(5):
                nx = x + (start + k) * dx
                ny = y + (start + k) * dy
                if not on_board(nx, ny):
                    good = False
                    break
                cells.append((nx, ny))
            if not good:
                continue
            own = 0
            other = 0
            for nx, ny in cells:
                if nx == x and ny == y:
                    own += 1
                    continue
                value = int(board[ny, nx])
                if value == player:
                    own += 1
                elif value == opponent:
                    other += 1
            if other:
                continue
            if own == 4:
                fours += 1
            elif own == 3:
                threes += 1
            elif own == 2:
                twos += 1
    return twos, threes, fours


def center_pref(x: int, y: int) -> float:
    mid = (SIZE - 1) / 2
    dist = math.hypot(x - mid, y - mid) / math.hypot(mid, mid)
    return 1.0 - dist


def adjacent(board: np.ndarray, x: int, y: int, player: int) -> int:
    total = 0
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if on_board(nx, ny) and board[ny, nx] == player:
                total += 1
    return total


def features(board: np.ndarray, x: int, y: int, player: int) -> np.ndarray:
    opponent = 3 - player
    own_run = run_score(board, x, y, player)
    opp_run = run_score(board, x, y, opponent)
    own2, own3, own4 = window_counts(board, x, y, player)
    opp2, opp3, opp4 = window_counts(board, x, y, opponent)
    return np.array(
        [
            math.log1p(own_run) / 12.0,
            math.log1p(opp_run) / 12.0,
            min(own4, 4) / 4.0,
            min(opp4, 4) / 4.0,
            min(own3, 8) / 8.0,
            min(opp3, 8) / 8.0,
            min(own2, 8) / 8.0,
            min(opp2, 8) / 8.0,
            center_pref(x, y),
            adjacent(board, x, y, player) / 8.0,
            adjacent(board, x, y, opponent) / 8.0,
            1.0,
        ],
        dtype=np.float64,
    )


def target_value(board: np.ndarray, x: int, y: int, player: int) -> float:
    opponent = 3 - player
    return (
        math.log1p(run_score(board, x, y, player))
        + 1.25 * math.log1p(run_score(board, x, y, opponent))
        + 0.35 * center_pref(x, y)
    )


def empties(board: np.ndarray) -> list[tuple[int, int]]:
    ys, xs = np.where(board == 0)
    return list(zip(xs.tolist(), ys.tolist()))


def winner(board: np.ndarray) -> int:
    for player in (1, 2):
        for y in range(SIZE):
            for x in range(SIZE):
                if board[y, x] != player:
                    continue
                for dx, dy in DIRS:
                    if all(
                        on_board(x + dx * k, y + dy * k) and board[y + dy * k, x + dx * k] == player
                        for k in range(5)
                    ):
                        return player
    return 0


def heuristic_move(board: np.ndarray, player: int, rng: np.random.Generator) -> tuple[int, int]:
    cells = empties(board)
    if rng.random() < 0.1:
        pick = cells[int(rng.integers(0, len(cells)))]
        return pick
    best = (-1e9, 0, 0)
    for x, y in cells:
        value = target_value(board, x, y, player)
        key = (value, -abs(x - 7) - abs(y - 7), -x)
        if key > best:
            best = key
            chosen = (x, y)
    return chosen


def play_games(n_games: int, rng: np.random.Generator) -> list[np.ndarray]:
    positions = []
    for _ in range(n_games):
        board = np.zeros((SIZE, SIZE), dtype=np.int8)
        player = 1
        for _turn in range(70):
            positions.append(board.copy())
            x, y = heuristic_move(board, player, rng)
            board[y, x] = player
            if winner(board):
                break
            if not empties(board):
                break
            player = 3 - player
    return positions


def settle_batch(feat: np.ndarray, B: np.ndarray, W: np.ndarray, input_index: np.ndarray) -> np.ndarray:
    n_cand, _n_feat = feat.shape
    n = W.shape[0]
    u = np.zeros((n_cand, n), dtype=np.float64)
    u[:, input_index] = feat @ B
    state = np.zeros((n_cand, n), dtype=np.float64)
    for _ in range(STEPS):
        drive = u + state @ W.T
        state = LEAK * state + (1.0 - LEAK) * np.tanh(drive)
    return state


def main() -> None:
    catalog = ensure_catalog()
    urls = {}
    for neuron in catalog["neurons"]:
        combined = neuron.get("urls", {}).get("combined")
        if combined:
            urls[neuron["name"]] = combined

    seeds = [name for name in urls if wanted(name)]
    seeds.sort()
    print(f"seed types {len(seeds)}")
    download_pages(seeds, urls)

    parsed = {}
    for name in seeds:
        parsed[name] = parse_page(PAGES / urls[name].replace("/", "_"))

    external_score: dict[str, float] = {}
    for name in seeds:
        if role_for(name) != "visual":
            continue
        for edge in parsed[name]["downstream"]:
            partner = edge["partner"]
            if partner in parsed or partner not in urls or edge["percent"] < 1.0:
                continue
            external_score[partner] = external_score.get(partner, 0.0) + edge["percent"]

    relays = [
        name
        for name, _score in sorted(external_score.items(), key=lambda item: -item[1])[:24]
    ]
    print("relays", ", ".join(relays))
    download_pages(relays, urls)
    for name in relays:
        parsed[name] = parse_page(PAGES / urls[name].replace("/", "_"))

    names = list(parsed)
    names.sort(key=lambda name: ({"visual": 0, "relay": 1, "courtship": 2, "descending": 3}[role_for(name)], name))
    index = {name: i for i, name in enumerate(names)}

    raw: dict[tuple[int, int], float] = {}
    for name, page in parsed.items():
        sign = SIGN.get(page["nt"], 0.5 if page["nt"] != "unknown" else 0.0)
        pre = index[name]
        for edge in page["downstream"]:
            post_name = edge["partner"]
            if post_name not in index or edge["percent"] < 0.4:
                continue
            weight = sign * math.log1p(edge["percent"])
            key = (pre, index[post_name])
            raw[key] = raw.get(key, 0.0) + weight

    n = len(names)
    dense = np.zeros((n, n), dtype=np.float64)
    for (pre, post), weight in raw.items():
        dense[post, pre] += weight
    incoming = np.abs(dense).sum(axis=1)
    scale = np.ones(n)
    scale[incoming > 0] = 1.0 / incoming[incoming > 0]
    dense *= scale[:, None]

    neurons = []
    for name in names:
        page = parsed[name]
        neurons.append(
            {
                "name": name,
                "nt": page["nt"],
                "confidence": round(page["confidence"], 1),
                "role": role_for(name),
                "nCells": page["n_cells"],
                "sign": SIGN.get(page["nt"], 0.0),
                "href": BASE + urls[name],
            }
        )
    layout(neurons)

    edges = []
    for post in range(n):
        for pre in range(n):
            weight = dense[post, pre]
            if abs(weight) < 1e-6:
                continue
            edges.append((pre, post, round(float(weight), 6)))
    W = np.zeros_like(dense)
    for pre, post, weight in edges:
        W[post, pre] = weight

    input_index = np.array([i for i, neuron in enumerate(neurons) if neuron["role"] == "visual"], dtype=int)
    rng = np.random.default_rng(SEED)
    B = rng.normal(scale=0.55, size=(12, len(input_index)))
    B = np.round(B, 6)

    print(
        f"types {n} edges {len(edges)} visual {len(input_index)} "
        f"cells {sum(item['nCells'] for item in neurons)}"
    )
    visual_out = sum(1 for pre, post, _w in edges if neurons[pre]["role"] == "visual" and pre != post)
    print("visual outgoing edges", visual_out)

    train_rng = np.random.default_rng(7)
    games = play_games(60, train_rng)
    split = int(len(games) * 0.8)
    train_pos, test_pos = games[:split], games[split:]

    def sample_rows(positions, row_rng):
        xs = []
        ys = []
        for board in positions[::2]:
            cells = empties(board)
            if len(cells) > 36:
                scored = sorted(
                    ((target_value(board, x, y, 2), x, y) for x, y in cells),
                    reverse=True,
                )
                keep = [(x, y) for _v, x, y in scored[:18]]
                rest = [(x, y) for _v, x, y in scored[18:]]
                pick = row_rng.choice(len(rest), size=min(10, len(rest)), replace=False)
                keep.extend(rest[i] for i in pick)
                cells = keep
            for x, y in cells:
                xs.append(features(board, x, y, 2))
                ys.append(target_value(board, x, y, 2))
        return np.vstack(xs), np.asarray(ys, dtype=np.float64)

    X_feat, y = sample_rows(train_pos, train_rng)
    print("train rows", len(y))
    states = []
    batch = 4000
    for start in range(0, len(X_feat), batch):
        states.append(settle_batch(X_feat[start : start + batch], B, W, input_index))
    state = np.vstack(states)
    design = np.concatenate([state, np.ones((len(state), 1))], axis=1)
    lam = 2.0
    gram = design.T @ design
    gram.flat[:: gram.shape[0] + 1] += lam
    gram[-1, -1] -= lam
    coef = np.linalg.solve(gram, design.T @ y)
    readout = np.round(coef[:-1], 6)
    bias = round(float(coef[-1]), 6)

    def predict_board(board: np.ndarray) -> tuple[int, int, float]:
        cells = empties(board)
        feat = np.vstack([features(board, x, y, 2) for x, y in cells])
        activity = settle_batch(feat, B, W, input_index)
        scores = activity @ readout + bias
        order = np.argsort(-scores)
        best_i = int(order[0])
        # Stable tie break toward the center.
        top = np.flatnonzero(np.abs(scores - scores[best_i]) < 1e-7)
        if len(top) > 1:
            best_i = min(top, key=lambda i: abs(cells[i][0] - 7) + abs(cells[i][1] - 7))
        return cells[best_i][0], cells[best_i][1], float(scores[best_i])

    def forced(board: np.ndarray, expect: set[tuple[int, int]], label: str) -> None:
        move = predict_board(board)[:2]
        ok = move in expect
        print(label, move, "ok" if ok else f"MISS expected {sorted(expect)}")

    block = np.zeros((SIZE, SIZE), dtype=np.int8)
    block[7, 0:4] = 1
    forced(block, {(4, 7)}, "block edge four")

    block2 = np.zeros((SIZE, SIZE), dtype=np.int8)
    block2[8, 4:8] = 1
    forced(block2, {(3, 8), (8, 8)}, "block open four")

    take = np.zeros((SIZE, SIZE), dtype=np.int8)
    take[4, 6:10] = 2
    forced(take, {(5, 4), (10, 4)}, "take open four")

    gap = np.zeros((SIZE, SIZE), dtype=np.int8)
    gap[10, 5] = gap[10, 6] = gap[10, 7] = gap[10, 9] = 1
    forced(gap, {(8, 10)}, "fill opponent gap")

    agree = 0
    top3 = 0
    tested = 0
    for board in test_pos[::3]:
        if winner(board) or not empties(board):
            continue
        cells = empties(board)
        values = [target_value(board, x, y, 2) for x, y in cells]
        rank = sorted(range(len(cells)), key=lambda i: values[i], reverse=True)
        fly = predict_board(board)[:2]
        tested += 1
        if cells[rank[0]] == fly:
            agree += 1
        if fly in {cells[i] for i in rank[:3]}:
            top3 += 1
    print(f"held-out exact {agree}/{tested} top3 {top3}/{tested}")

    fixture_board = np.zeros((SIZE, SIZE), dtype=np.int8)
    fixture_board[7, 2:5] = 1
    fixture_board[6, 6] = 2
    feat = features(fixture_board, 5, 7, 2)
    activity = settle_batch(feat.reshape(1, -1), B, W, input_index)[0]
    fixture_score = round(float(activity @ readout + bias), 6)

    circuit = {
        "dataset": "male-cns:v1.0",
        "source": "Male CNS Cell Type Explorer snapshot 2026-09-09, derived from neuPrint male-cns:v1.0",
        "size": SIZE,
        "steps": STEPS,
        "leak": LEAK,
        "neurons": neurons,
        "edges": edges,
        "inputIndex": input_index.tolist(),
        "B": B.reshape(-1).tolist(),
        "readout": readout.tolist(),
        "bias": bias,
        "fixture": {
            "board": fixture_board.tolist(),
            "x": 5,
            "y": 7,
            "player": 2,
            "score": fixture_score,
        },
    }
    payload = "var CIRCUIT = " + json.dumps(circuit, separators=(",", ":")) + ";\n"
    (ROOT / "circuit.js").write_text(payload, encoding="utf-8")
    print("wrote", ROOT / "circuit.js", "bytes", len(payload))


if __name__ == "__main__":
    main()
