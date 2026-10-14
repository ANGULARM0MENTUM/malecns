# Gomoku with the male fly

A 15×15 Gomoku board whose amber stones are chosen by a circuit from the public male fruit-fly CNS connectome (`male-cns:v1.0`).

You play black. The fly plays amber. First five in a row wins. The Focused–Restless slider keeps the same circuit and only changes how sharply the top-ranked squares are sampled.

## Play

Open `index.html` in a browser. No install and no server. The board is tilted in 3D. Black stones are yours. After the circuit settles, the fly walks onto the square and leaves an amber stone, then returns to the near edge. The panel on the right is the same cell-type circuit, drawn in the shape of a fly head: compound eyes, antennae, central brain, and mouthparts.

Hover a point in the circuit panel to see the cell type. Click it to open that type in the Male CNS Cell Type Explorer.

## What the opponent is

The nodes are cell types, not all 166,700 neurons. The circuit is:

- visual types that can see structure: Mi1, T4/T5, LPLC, LC10 and nearby LC types
- the strongest cell types those visual neurons actually synapse onto
- male courtship types (`pC1`, `pIP10`, `aSP22`, and related names)
- descending neurons, including `DNg13`

Edges are the published mean synapse counts from the presynaptic type, signed by its predicted transmitter (acetylcholine excites; GABA and glutamate inhibit). A linear readout was fit so this frozen circuit ranks Gomoku squares. The synapses were not changed.

Connectivity comes from the [Male CNS Cell Type Explorer](https://reiserlab.github.io/celltype-explorer-drosophila-male-cns/) snapshot of 9 September 2026, which was generated from neuPrint `male-cns:v1.0`. Dataset home: [male-cns.janelia.org](https://male-cns.janelia.org/).

This folder is a separate game. It is not part of the `malecns` R package.

## Rebuild the circuit

`build_circuit.py` re-downloads the type pages and refits the readout. It needs Python 3 with `numpy`, and `curl`.

```bash
py -3 build_circuit.py
```
