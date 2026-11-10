# Jiyo against the odds

A chess practice and learning app that runs entirely in the browser. Play against Stockfish at adjustable strength, get move-by-move feedback, and drill openings.

Built with React, TypeScript, Vite, [chess.js](https://github.com/jhlywa/chess.js), [react-chessboard](https://github.com/Clariity/react-chessboard) and Stockfish 19 (lite, single-threaded WASM) running in a Web Worker.

## Features

- Play as White or Black against Stockfish, with a strength slider (level 0 to 20, with approximate Elo)
- Position evaluation bar and per-move ratings (best, good, inaccuracy, mistake, blunder)
- Accuracy and estimated Elo for both sides
- Hint: best move with a short explanation and a list of threatened pieces
- Move options: every legal move ranked by the engine
- Opening detection with a short description, plus an opening trainer with a set of common lines
- Practice mode that hides the analysis until the game ends
- Board editor to set up any position, bot override, undo and redo, sound
- Dark and light themes, responsive layout

## Getting started

Requires Node.js and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173.

Other scripts:

```bash
pnpm build     # typecheck and production build into dist/
pnpm preview   # serve the production build locally
pnpm lint      # run oxlint
```

## Project structure

- `src/App.tsx`: UI and game logic
- `src/engine.ts`: Stockfish worker wrapper
- `src/analysis.ts`: move rating, threats and move explanations
- `src/openings.ts`, `src/openings.json`: opening database
- `src/trainer.ts`: opening trainer lines
- `public/stockfish/`: Stockfish WASM build

## Notes

- The engine is a lite WASM build, so playing strength depends on the device and the engine's thinking time. The Elo values shown are approximate.
- The bundled Stockfish.js is licensed under GPLv3. See the header of `public/stockfish/stockfish-19-lite-single.js` for details.
