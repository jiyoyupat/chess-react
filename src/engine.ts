// Thin wrapper around Stockfish (WASM) running in a Web Worker, speaking UCI.
export type Score = { cp: number; mate: number | null } // from the side to move's point of view
export type SearchLine = { move: string; score: Score } // one MultiPV line
export type SearchResult = { move: string; score: Score | null; lines?: SearchLine[] }

export class Engine {
  private worker: Worker
  // FIFO queue: every `go` produces exactly one `bestmove`. Searches run one at a time.
  private pending: Array<(r: SearchResult) => void> = []
  private jobs: Array<{ fen: string; ms: number }> = []
  private running = false
  private lastScore: Score | null = null
  private lines = new Map<number, SearchLine>() // MultiPV index -> latest line

  constructor(url: string) {
    this.worker = new Worker(url)
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data)
      if (line.startsWith('info') && line.includes(' score ') && !/bound/.test(line)) {
        const m = line.match(/score (cp|mate) (-?\d+)/)
        if (m) {
          const n = Number(m[2])
          this.lastScore = m[1] === 'cp' ? { cp: n, mate: null } : { cp: 0, mate: n }
          const idx = line.match(/ multipv (\d+)/)
          const pv = line.match(/ pv (\S+)/)
          if (idx && pv) this.lines.set(Number(idx[1]), { move: pv[1], score: this.lastScore })
        }
      } else if (line.startsWith('bestmove')) {
        const lines = [...this.lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
        this.lines.clear()
        const result = { move: line.split(' ')[1], score: this.lastScore, lines }
        this.lastScore = null
        this.pending.shift()?.(result)
        this.running = false
        this.pump()
      }
    }
    this.worker.postMessage('uci')
    this.worker.postMessage('isready')
  }

  /** Skill Level 0 (weakest) to 20 (maximum). */
  setSkill(level: number) {
    this.worker.postMessage(`setoption name Skill Level value ${level}`)
  }

  /** Number of lines (best moves) reported per search; 1 = normal play. */
  setMultiPv(n: number) {
    this.worker.postMessage(`setoption name MultiPV value ${n}`)
  }

  /** Find the best move + evaluate the position. Move is in UCI notation, e.g. "e2e4" or "e7e8q". */
  search(fen: string, movetimeMs = 500): Promise<SearchResult> {
    return new Promise((resolve) => {
      this.pending.push(resolve)
      this.jobs.push({ fen, ms: movetimeMs })
      this.pump()
    })
  }

  // Start the next queued search only when the engine is idle.
  private pump() {
    if (this.running) return
    const job = this.jobs.shift()
    if (!job) return
    this.running = true
    this.worker.postMessage(`position fen ${job.fen}`)
    this.worker.postMessage(`go movetime ${job.ms}`)
  }

  bestMove(fen: string, movetimeMs = 500): Promise<string> {
    return this.search(fen, movetimeMs).then((r) => r.move)
  }

  terminate() {
    this.worker.terminate()
    this.pending = []
    this.jobs = []
  }
}
