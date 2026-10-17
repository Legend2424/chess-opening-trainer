# Stockfish engine

`stockfish-nnue-16-single.js` + `.wasm` are **Stockfish 16** compiled to WebAssembly
(single-threaded build) from [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js).

- Stockfish is free software under the **GNU General Public License v3** (GPLv3).
  Source code: <https://github.com/official-stockfish/Stockfish> (engine) and
  <https://github.com/nmrugg/stockfish.js> (the WebAssembly port these files come from).
- The app runs the engine with its **classical evaluation**: the NNUE network file
  (`nn-5af11540bbfe.nnue`, ~40 MB) is not shipped — this build has `Use NNUE` off by
  default and never downloads it, so it only made the site 40 MB heavier.
