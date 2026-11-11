import { useEffect, useRef, useState } from 'react'
import { Chess, type Move, type Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { Engine } from './engine'
import {
  RATINGS,
  findThreats,
  explainMove,
  formatEval,
  rateMove,
  terminalAnalysis,
  toAnalysis,
  uciToSan,
  winPct,
  type Analysis,
  type MoveReview,
  type Rating,
} from './analysis'
import './App.css'
import { isMuted, playGameEnd, playMove, setMuted, type MoveSound } from './sound'
import { LINES, plain } from './trainer'
import { Icon } from './icons'
import { Rich } from './Rich'
import { explain, loadOpenings, lookup, type Opening, type OpeningDb } from './openings'

type Color = 'w' | 'b'
type PromotionPiece = 'q' | 'r' | 'b' | 'n'

// Ratings shown as a badge on the board for the player's last move.
const BADGE_RATINGS: Rating[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']

const PROMOTIONS: { piece: PromotionPiece; label: string; white: string; black: string }[] = [
  { piece: 'q', label: 'Queen', white: '♕', black: '♛' },
  { piece: 'r', label: 'Rook', white: '♖', black: '♜' },
  { piece: 'b', label: 'Bishop', white: '♗', black: '♝' },
  { piece: 'n', label: 'Knight', white: '♘', black: '♞' },
]

const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`
const ANALYSIS_MS = 400

function getStatus(game: Chess, player: Color, thinking: boolean, override: boolean): string {
  if (game.isCheckmate()) {
    return game.turn() === player ? 'Checkmate. You lost.' : 'Checkmate. You won!'
  }
  if (game.isStalemate()) return 'Draw (stalemate).'
  if (game.isInsufficientMaterial()) return 'Draw (insufficient material).'
  if (game.isThreefoldRepetition()) return 'Draw (threefold repetition).'
  if (game.isDraw()) return 'Draw.'
  if (thinking) return 'Stockfish is thinking...'
  if (override && game.turn() !== player) {
    return `Bot override: move for ${game.turn() === 'w' ? 'White' : 'Black'}${game.inCheck() ? ' (check!)' : ''}.`
  }
  return game.inCheck() ? 'Your turn (check!).' : 'Your turn.'
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const GLYPH: Record<Color, Record<string, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' },
}

function averageAccuracy(reviews: (MoveReview | null)[], history: Move[], color: Color): string {
  const list = reviews.filter(
    (r, i): r is MoveReview => r !== null && history[i]?.color === color,
  )
  if (list.length === 0) return '-'
  return `${Math.round(list.reduce((s, r) => s + r.accuracy, 0) / list.length)}%`
}

/**
 * Rough Elo estimate from the average centipawn loss (ACPL) of one side's moves:
 * Elo ~ 3100 * e^(-0.01 * ACPL). Needs a few analysed moves; very approximate.
 */
function estimateElo(evals: Record<string, Analysis>, history: Move[], color: Color): string {
  const sign = color === 'w' ? 1 : -1
  const losses: number[] = []
  for (const m of history) {
    if (m.color !== color) continue
    const before = evals[m.before]
    const after = evals[m.after]
    if (!before || !after) continue
    // Cap each move so a single mate-score swing doesn't dominate the average.
    losses.push(Math.min(500, Math.max(0, sign * (before.cp - after.cp))))
  }
  if (losses.length < 6) return '-'
  const acpl = losses.reduce((s, l) => s + l, 0) / losses.length
  const elo = Math.min(3200, Math.max(400, 3100 * Math.exp(-0.01 * acpl)))
  return `~${Math.round(elo / 50) * 50}`
}

type Editor = {
  pieces: Record<string, string> // square -> 'wK', 'bP', ...
  turn: Color
  tool: string | null // piece code to place, 'erase', or null
  error: string | null
}

const PALETTE_TYPES = ['K', 'Q', 'R', 'B', 'N', 'P']

// An imported game being replayed (PGN import).
type Review = { moves: Move[]; white: string; black: string; result: string }

function replayTo(moves: Move[], n: number): Chess {
  const g = new Chess(moves[0].before)
  for (let i = 0; i < n; i++) g.move({ from: moves[i].from, to: moves[i].to, promotion: moves[i].promotion })
  return g
}

/** Rough Elo for a Stockfish Skill Level (0 -> ~1350, 20 -> ~3200), rounded to 50. */
function approxElo(level: number): number {
  return Math.round((1350 + (level * (3190 - 1350)) / 20) / 50) * 50
}

/** Random pause (0.8-1.8s) before the bot plays, so its moves don't appear instantly. */
function botDelay(): number {
  return 800 + Math.random() * 1000
}

const RATING_ORDER: Rating[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']
const RATING_COLOR: Record<Rating, string> = {
  best: '#3b82f6',
  excellent: '#22b8cf',
  good: '#9aa5b1',
  inaccuracy: '#f5c518',
  mistake: '#ff8c1a',
  blunder: '#ff3b3b',
}
type MoveOption = { uci: string; san: string; review: MoveReview; eval: Analysis }

// Builds a FEN from the editor's pieces. Castling rights are kept only where king and rook are home.
function editorFen(e: Editor): string {
  const rows: string[] = []
  for (let rank = 8; rank >= 1; rank--) {
    let row = ''
    let empty = 0
    for (const file of 'abcdefgh') {
      const p = e.pieces[file + rank]
      if (!p) {
        empty++
        continue
      }
      if (empty) row += empty
      empty = 0
      row += p[0] === 'w' ? p[1] : p[1].toLowerCase()
    }
    rows.push(row + (empty || ''))
  }
  const at = (sq: string, p: string) => e.pieces[sq] === p
  let castling = ''
  if (at('e1', 'wK') && at('h1', 'wR')) castling += 'K'
  if (at('e1', 'wK') && at('a1', 'wR')) castling += 'Q'
  if (at('e8', 'bK') && at('h8', 'bR')) castling += 'k'
  if (at('e8', 'bK') && at('a8', 'bR')) castling += 'q'
  return `${rows.join('/')} ${e.turn} ${castling || '-'} - 0 1`
}

export default function App() {
  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(gameRef.current.fen())
  const [player, setPlayer] = useState<Color>('w')
  const [skill, setSkill] = useState(() => {
    const saved = Number(localStorage.getItem('skill'))
    return localStorage.getItem('skill') !== null && saved >= 0 && saved <= 20 ? Math.round(saved) : 10
  })
  const [engine, setEngine] = useState<Engine | null>(null) // opponent
  const [analyzer, setAnalyzer] = useState<Engine | null>(null) // position evaluation (always level 20)
  const [evals, setEvals] = useState<Record<string, Analysis>>({})
  const [selected, setSelected] = useState<string | null>(null) // square selected for click-to-move
  const [hintFen, setHintFen] = useState<string | null>(null) // position the hint was requested for
  const requested = useRef(new Set<string>())
  const sideRef = useRef<HTMLDivElement>(null)
  const plies = useRef(0) // number of moves already played, to detect new moves
  const [mute, setMute] = useState(isMuted())
  const [flip, setFlip] = useState(false)
  const [training, setTraining] = useState<{ line: number; mistakes: number } | null>(null)
  const [pick, setPick] = useState(0) // opening selected in the trainer dropdown
  const [notice, setNotice] = useState<string | null>(null) // trainer feedback
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null)
  const [practice, setPractice] = useState(() => localStorage.getItem('practice') === '1')
  const [book, setBook] = useState<OpeningDb | null>(null)
  const [override, setOverride] = useState(false) // you play the bot's moves yourself
  const [redoStack, setRedoStack] = useState<{ from: string; to: string; promotion?: string }[]>([]) // last item = next move to redo
  const [editor, setEditor] = useState<Editor | null>(null) // board setup mode
  const [custom, setCustom] = useState(false) // game started from a custom position
  const [optionsFen, setOptionsFen] = useState<string | null>(null) // position the move options were requested for
  const [optionsData, setOptionsData] = useState<{ fen: string; items: MoveOption[] } | null>(null)
  const [optPick, setOptPick] = useState<{ fen: string; uci: string } | null>(null)
  const [review, setReview] = useState<Review | null>(null) // imported game being replayed
  const [pgnBox, setPgnBox] = useState<{ text: string; error: string | null } | null>(null)
  const scoutRef = useRef<Engine | null>(null) // third engine, MultiPV, created on first use

  const game = gameRef.current
  const isOver = game.isGameOver()
  const hideAnalysis = practice && !isOver && !review // practice mode: analysis is revealed when the game ends
  const mover = override || review ? game.turn() : player // whose pieces you can move right now
  const engineTurn = !isOver && !override && !editor && !review && game.turn() !== player
  const ply = game.history().length
  const line = training ? LINES[training.line] : null
  const inLine = line !== null && ply < line.moves.length // still following the book line

  useEffect(() => {
    const a = new Engine(ENGINE_URL)
    const b = new Engine(ENGINE_URL)
    setEngine(a)
    setAnalyzer(b)
    return () => {
      a.terminate()
      b.terminate()
      scoutRef.current?.terminate()
      scoutRef.current = null
      requested.current.clear()
    }
  }, [])

  // Move options: rate every legal move with one MultiPV search, then pick one move per rating.
  useEffect(() => {
    if (!optionsFen || optionsFen !== fen || optionsData?.fen === fen) return
    const g = new Chess(fen)
    const n = g.moves().length
    if (n === 0) return
    let cancelled = false
    scoutRef.current ??= new Engine(ENGINE_URL)
    const scout = scoutRef.current
    scout.setMultiPv(n)
    scout.search(fen, 1500).then((r) => {
      if (cancelled || !r.lines || r.lines.length === 0) return
      const best = toAnalysis(fen, { move: r.lines[0].move, score: r.lines[0].score })
      best.best = r.lines[0].move
      const groups = new Map<Rating, MoveOption[]>()
      for (const l of r.lines) {
        const ev = toAnalysis(fen, { move: l.move, score: l.score })
        const review = rateMove(g.turn(), l.move, best, ev)
        const san = uciToSan(fen, l.move)
        if (!san) continue
        groups.set(review.rating, [...(groups.get(review.rating) ?? []), { uci: l.move, san, review, eval: ev }])
      }
      const items: MoveOption[] = []
      for (const rating of RATING_ORDER) {
        const list = groups.get(rating)
        if (list) items.push(rating === 'blunder' ? list[list.length - 1] : list[0])
      }
      setOptionsData({ fen, items })
    })
    return () => {
      cancelled = true
    }
  }, [optionsFen, fen])

  useEffect(() => {
    loadOpenings().then(setBook)
  }, [])

  useEffect(() => {
    engine?.setSkill(skill)
  }, [engine, skill])

  // Computer's turn: play the book move while training, otherwise ask Stockfish.
  // The result is ignored if the state has changed in the meantime.
  useEffect(() => {
    if (!engineTurn) return
    if (inLine && line) {
      const timer = setTimeout(() => {
        gameRef.current.move(line.moves[gameRef.current.history().length])
        setRedoStack([])
        setFen(gameRef.current.fen())
      }, botDelay())
      return () => clearTimeout(timer)
    }
    if (!engine) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const wait = botDelay()
    engine.bestMove(fen).then((uci) => {
      if (cancelled) return
      // The engine answers in ~0.5s; hold the move back so the bot doesn't reply instantly.
      timer = setTimeout(() => {
        gameRef.current.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4],
        })
        setRedoStack([])
        setFen(gameRef.current.fen())
      }, Math.max(0, wait - (Date.now() - started)))
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [engine, engineTurn, fen, inLine, line])

  // Analyze every position not yet evaluated (results are cached per FEN).
  useEffect(() => {
    if (!analyzer) return
    const g = review ? review.moves : game.history({ verbose: true })
    const fens = [g[0]?.before ?? game.fen(), ...g.map((m) => m.after)]
    for (const f of fens) {
      if (requested.current.has(f)) continue
      requested.current.add(f)
      const t = terminalAnalysis(f)
      if (t) {
        setEvals((p) => ({ ...p, [f]: t }))
        continue
      }
      analyzer.search(f, ANALYSIS_MS).then((r) => setEvals((p) => ({ ...p, [f]: toAnalysis(f, r) })))
    }
  }, [analyzer, fen, game, review])

  // Play a sound only when a move was added (not on undo or new game).
  useEffect(() => {
    const h = game.history({ verbose: true })
    const added = h.length > plies.current
    plies.current = h.length
    if (!added) return
    const last = h[h.length - 1]
    if (game.isCheckmate()) {
      playGameEnd(last.color === player ? 'win' : 'loss')
    } else if (game.isDraw()) {
      playGameEnd('draw')
    } else {
      let kind: MoveSound = 'move'
      if (game.inCheck()) kind = 'check'
      else if (last.captured) kind = 'capture'
      else if (last.isKingsideCastle() || last.isQueensideCastle()) kind = 'castle'
      playMove(kind)
    }
  }, [fen, game, player])

  // Auto-scroll the move list to the bottom on every new move (to the current move while reviewing).
  useEffect(() => {
    const el = sideRef.current
    if (!el) return
    if (review) el.querySelector('.cur')?.scrollIntoView({ block: 'nearest' })
    else el.scrollTop = el.scrollHeight
  }, [fen, review])

  // Review mode: left/right arrows step through the game.
  useEffect(() => {
    if (!review || editor) return
    const onKey = (e: KeyboardEvent) => {
      const tag = e.target instanceof HTMLElement ? e.target.tagName : ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const n = game.history().length
      if (e.key === 'ArrowLeft') goTo(n - 1)
      else if (e.key === 'ArrowRight') goTo(n + 1)
      else if (e.key === 'Home') goTo(0)
      else if (e.key === 'End') goTo(review.moves.length)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [review, editor, fen])

  function tryMove(from: string, to: string, promotion?: PromotionPiece): boolean {
    if (review || game.turn() !== mover || isOver) return false
    // A pawn reaching the last rank: ask which piece to promote to.
    if (
      !promotion &&
      game.moves({ square: from as Square, verbose: true }).some((m) => m.to === to && m.promotion)
    ) {
      setPendingPromo({ from, to })
      setSelected(null)
      return false
    }
    try {
      const m = game.move({ from, to, promotion })
      if (m.color === player && inLine && line && plain(m.san) !== plain(line.moves[ply])) {
        game.undo()
        setTraining((t) => t && { ...t, mistakes: t.mistakes + 1 })
        setNotice(`${m.san} is not the book move. Try again (Hint shows the book move).`)
        setSelected(null)
        setPendingPromo(null)
        return false
      }
    } catch {
      return false
    }
    setNotice(null)
    setSelected(null)
    setPendingPromo(null)
    setRedoStack([])
    setFen(game.fen())
    return true
  }

  function onPieceDrop({
    sourceSquare,
    targetSquare,
  }: {
    sourceSquare: string
    targetSquare: string | null
  }) {
    if (!targetSquare) return false
    return tryMove(sourceSquare, targetSquare)
  }

  // Show move options when a piece starts being dragged, too.
  function onPieceDrag({ square }: { square: string | null }) {
    if (!square || review || game.turn() !== mover || isOver) return
    setSelected(game.get(square as Square)?.color === mover ? square : null)
  }

  // Click-to-move: click your own piece, then click the target square.
  function onSquareClick({ square }: { square: string }) {
    setPendingPromo(null) // clicking elsewhere cancels the promotion picker
    if (review || game.turn() !== mover || isOver) return
    if (selected && tryMove(selected, square)) return
    const piece = game.get(square as Square)
    if (piece?.color === mover) setSelected(square)
    else setSelected(null)
  }

  function newGame(color: Color) {
    gameRef.current = new Chess()
    setReview(null)
    setPgnBox(null)
    setCustom(false)
    setEditor(null)
    setRedoStack([])
    setSelected(null)
    setPendingPromo(null)
    setTraining(null)
    setNotice(null)
    setPlayer(color)
    setFlip(false)
    setFen(gameRef.current.fen())
  }

  function goTo(n: number) {
    if (!review) return
    const target = Math.max(0, Math.min(review.moves.length, n))
    gameRef.current = replayTo(review.moves, target)
    setSelected(null)
    setFen(gameRef.current.fen())
  }

  function openReview(text: string) {
    const g = new Chess()
    try {
      g.loadPgn(text)
    } catch {
      setPgnBox((b) => b && { ...b, error: 'Could not read this PGN. Paste the full game text including the moves.' })
      return
    }
    const moves = g.history({ verbose: true })
    if (moves.length === 0) {
      setPgnBox((b) => b && { ...b, error: 'No moves found in this PGN.' })
      return
    }
    const h = g.getHeaders()
    const name = (n: string | undefined, elo: string | undefined, fallback: string) =>
      `${n && n !== '?' ? n : fallback}${elo && elo !== '?' ? ` (${elo})` : ''}`
    setReview({
      moves,
      white: name(h.White, h.WhiteElo, 'White'),
      black: name(h.Black, h.BlackElo, 'Black'),
      result: h.Result ?? '*',
    })
    setPgnBox(null)
    setEditor(null)
    setTraining(null)
    setNotice(null)
    setSelected(null)
    setPendingPromo(null)
    setHintFen(null)
    setOptionsFen(null)
    setOptPick(null)
    setRedoStack([])
    setPlayer('w')
    setFlip(false)
    setCustom(moves[0].before !== new Chess().fen())
    gameRef.current = replayTo(moves, 0)
    setFen(gameRef.current.fen())
  }

  function switchSide() {
    setPlayer(player === 'w' ? 'b' : 'w')
    setFlip(false)
    setSelected(null)
    setPendingPromo(null)
    setHintFen(null)
    setOptionsFen(null)
    setOptPick(null)
    setRedoStack([])
  }

  function startTraining(lineIndex: number, color: Color) {
    gameRef.current = new Chess()
    setReview(null)
    setPgnBox(null)
    setCustom(false)
    setEditor(null)
    setRedoStack([])
    setSelected(null)
    setPendingPromo(null)
    setHintFen(null)
    setNotice(null)
    setTraining({ line: lineIndex, mistakes: 0 })
    setPlayer(color)
    setFlip(false)
    setFen(gameRef.current.fen())
  }

  function stopTraining() {
    setTraining(null)
    setNotice(null)
  }

  function startEditor() {
    const pieces: Record<string, string> = {}
    for (const row of game.board()) {
      for (const sq of row) if (sq) pieces[sq.square] = sq.color + sq.type.toUpperCase()
    }
    setSelected(null)
    setPendingPromo(null)
    setHintFen(null)
    setEditor({ pieces, turn: game.turn(), tool: null, error: null })
  }

  function patchEditor(p: Partial<Editor>) {
    setEditor((e) => e && { ...e, error: null, ...p })
  }

  function editClick({ square }: { square: string }) {
    setEditor((e) => {
      if (!e || !e.tool) return e
      const pieces = { ...e.pieces }
      if (e.tool === 'erase') delete pieces[square]
      else pieces[square] = e.tool
      return { ...e, pieces, error: null }
    })
  }

  // Drag a piece to move it; dropping it off the board removes it.
  function editDrop({
    sourceSquare,
    targetSquare,
  }: {
    sourceSquare: string
    targetSquare: string | null
  }) {
    setEditor((e) => {
      if (!e) return e
      const pieces = { ...e.pieces }
      const piece = pieces[sourceSquare]
      delete pieces[sourceSquare]
      if (targetSquare && piece) pieces[targetSquare] = piece
      return { ...e, pieces, error: null }
    })
    return true
  }

  function applyEditor() {
    if (!editor) return
    const fenStr = editorFen(editor)
    let g: Chess
    try {
      g = new Chess(fenStr)
    } catch {
      patchEditor({ error: 'Invalid position: each side needs exactly one king.' })
      return
    }
    if (Object.entries(editor.pieces).some(([sq, p]) => p[1] === 'P' && (sq[1] === '1' || sq[1] === '8'))) {
      patchEditor({ error: 'Pawns cannot stand on the first or last rank.' })
      return
    }
    // Stockfish crashes with more than 16 pieces (or 8 pawns) per side.
    for (const c of ['w', 'b']) {
      const own = Object.values(editor.pieces).filter((p) => p[0] === c)
      if (own.length > 16 || own.filter((p) => p[1] === 'P').length > 8) {
        patchEditor({
          error: `${c === 'w' ? 'White' : 'Black'} has too many pieces (max 16 per side, 8 pawns).`,
        })
        return
      }
    }
    const parts = fenStr.split(' ')
    parts[1] = editor.turn === 'w' ? 'b' : 'w'
    try {
      if (new Chess(parts.join(' ')).inCheck()) {
        patchEditor({ error: 'The side that is not to move cannot be in check.' })
        return
      }
    } catch {
      // ignore: validated above
    }
    gameRef.current = g
    setReview(null)
    setCustom(true)
    setEditor(null)
    setSelected(null)
    setPendingPromo(null)
    setHintFen(null)
    setNotice(null)
    setTraining(null)
    setRedoStack([])
    setFen(g.fen())
  }

  function undo() {
    // Take back the computer's move + the player's move (one move only in override mode).
    const undone: (Move | null)[] = []
    if (!override && game.turn() === player) undone.push(game.undo())
    undone.push(game.undo())
    setRedoStack((r) => [
      ...r,
      ...undone.flatMap((m) => (m ? [{ from: m.from, to: m.to, promotion: m.promotion }] : [])),
    ])
    setSelected(null)
    setFen(game.fen())
  }

  function redo() {
    // Replay the undone move(s); with the bot active, also its reply.
    const stack = [...redoStack]
    const replay = () => {
      const mv = stack.pop()
      if (mv) game.move(mv)
    }
    replay()
    if (!override && game.turn() !== player && stack.length) replay()
    setRedoStack(stack)
    setSelected(null)
    setFen(game.fen())
  }

  const squareStyles: Record<string, React.CSSProperties> = {}
  const showHint = hintFen === fen && !isOver && game.turn() === mover
  const threats = showHint ? findThreats(game, mover) : []
  const hintBook = showHint && inLine && line ? line.moves[ply] : null
  let hintBest: string | null = null
  if (hintBook) {
    try {
      const m = new Chess(fen).move(hintBook)
      hintBest = m.from + m.to + (m.promotion ?? '')
    } catch {
      hintBest = null
    }
  } else if (showHint) {
    hintBest = evals[fen]?.best ?? null
  }
  const hintSan = hintBook ?? (hintBest ? uciToSan(fen, hintBest) : null)
  const hintWhy = hintBest ? explainMove(fen, hintBest, hintBook ? undefined : evals[fen]) : []
  // Highlight the opponent's last move (from and to squares).
  const lastOpp = game.history({ verbose: true }).findLast((m) => review || m.color !== player)
  if (lastOpp) {
    for (const sq of [lastOpp.from, lastOpp.to]) {
      squareStyles[sq] = { backgroundColor: 'rgba(255, 170, 0, 0.5)' }
    }
  }
  // Non-practice mode: tint your pieces red when they can be captured profitably.
  if (!hideAnalysis && !isOver && !editor) {
    for (const t of findThreats(game, mover)) {
      squareStyles[t.square] = { ...squareStyles[t.square], backgroundColor: 'rgba(255, 40, 40, 0.55)' }
    }
  }
  for (const t of threats) {
    squareStyles[t.square] = {
      ...squareStyles[t.square],
      boxShadow: 'inset 0 0 0 4px rgba(255, 60, 60, 0.9)',
    }
  }
  const arrows = hintBest
    ? [{ startSquare: hintBest.slice(0, 2), endSquare: hintBest.slice(2, 4), color: 'rgba(59, 130, 246, 0.85)' }]
    : []
  const showOptions = optionsFen === fen && !isOver && game.turn() === mover
  const optItems = optionsData?.fen === fen ? optionsData.items : null
  const picked = showOptions && optPick?.fen === fen ? optItems?.find((o) => o.uci === optPick.uci) : undefined
  if (picked) {
    arrows.push({
      startSquare: picked.uci.slice(0, 2),
      endSquare: picked.uci.slice(2, 4),
      color: RATING_COLOR[picked.review.rating],
    })
  }
  if (selected) {
    squareStyles[selected] = {
      ...squareStyles[selected],
      boxShadow: 'inset 0 0 0 4px rgba(255, 200, 0, 0.9)',
    }
    for (const m of game.moves({ square: selected as Square, verbose: true })) {
      squareStyles[m.to] = {
        ...squareStyles[m.to],
        backgroundImage: m.captured
          ? 'radial-gradient(circle, transparent 58%, rgba(0, 0, 0, 0.3) 60%)'
          : 'radial-gradient(circle, rgba(0, 0, 0, 0.3) 26%, transparent 28%)',
      }
    }
  }

  const history = game.history({ verbose: true })
  const rate = (m: Move) => {
    const before = evals[m.before]
    const after = evals[m.after]
    if (!before || !after) return null
    return rateMove(m.color, m.from + m.to + (m.promotion ?? ''), before, after)
  }
  const reviews = history.map(rate)
  // While reviewing an imported game, the move list, accuracy and Elo cover the whole game.
  const allHistory = review ? review.moves : history
  const allReviews = review ? allHistory.map(rate) : reviews

  const current = evals[fen]
  const whitePct = current ? winPct(current.cp) : 50
  const flipped = (player === 'b') !== flip

  // Pieces each side has captured, cheapest first, plus the material balance.
  const capturedBy = (color: Color) =>
    history
      .filter((m) => m.color === color && m.captured)
      .map((m) => m.captured as string)
      .sort((a, b) => PIECE_VALUE[a] - PIECE_VALUE[b])
  const opponent: Color = player === 'w' ? 'b' : 'w'
  const mine = capturedBy(player)
  const theirs = capturedBy(opponent)
  const sum = (ps: string[]) => ps.reduce((n, p) => n + PIECE_VALUE[p], 0)
  const lead = sum(mine) - sum(theirs) // > 0: you are ahead in material

  // Feedback for the player's last move.
  let feedback: string | null = null
  let badge: { square: string; rating: Rating | 'pending' } | null = null
  for (let i = history.length - 1; i >= 0; i--) {
    if (!review && history[i].color !== player) continue
    const r = reviews[i]
    if (!r) {
      badge = { square: history[i].to, rating: 'pending' } // still analyzing
      break
    }
    const { label, symbol } = RATINGS[r.rating]
    feedback = `${history[i].san} ${symbol} ${label}`
    if (BADGE_RATINGS.includes(r.rating)) badge = { square: history[i].to, rating: r.rating }
    if (r.rating !== 'best' && r.best) {
      const san = uciToSan(history[i].before, r.best)
      if (san) feedback += ` (best: ${san})`
    }
    break
  }

  const rows: number[] = []
  // A game that starts with Black to move gets an empty White cell in the first row.
  const offset = allHistory[0]?.color === 'b' ? 1 : 0
  for (let i = -offset; i < allHistory.length; i += 2) rows.push(i)

  // Last opening matching a position in the history (transpositions match too).
  let opening: Opening | null = null
  let openingPly = -1
  if (book && !custom) {
    for (let i = history.length - 1; i >= 0 && !opening; i--) {
      opening = lookup(book, history[i].after)
      openingPly = i
    }
  }
  const outOfBook = opening !== null && openingPly < history.length - 1
  function cell(i: number) {
    const m = allHistory[i]
    if (!m) return <td />
    const r = hideAnalysis ? null : allReviews[i]
    const cls = `${r ? `mv ${r.rating}` : 'mv'}${review ? ' pick' : ''}${review && i === ply - 1 ? ' cur' : ''}`
    return (
      <td className={cls} onClick={review ? () => goTo(i + 1) : undefined}>
        {m.san}
        {r && <sup title={RATINGS[r.rating].label}> {RATINGS[r.rating].symbol}</sup>}
        {!hideAnalysis && <small> {formatEval(evals[m.after])}</small>}
      </td>
    )
  }

  return (
    <main className="app">
      <header className="header">
        <img src="/knight.svg" alt="" width={30} height={30} />
        <h1>
          Jiyo <span>against the</span> odds
        </h1>
      </header>
      <div className="boardrow">
        <div className="captured" aria-label="Captured pieces">
          <div className="capgroup" title={`Captured by ${opponent === 'w' ? 'White' : 'Black'}`}>
            {theirs.map((p, i) => (
              <span key={i}>{GLYPH[player][p]}</span>
            ))}
            {lead < 0 && <small>+{-lead}</small>}
          </div>
          <div className="capgroup" title={`Captured by ${player === 'w' ? 'White' : 'Black'}`}>
            {mine.map((p, i) => (
              <span key={i}>{GLYPH[opponent][p]}</span>
            ))}
            {lead > 0 && <small>+{lead}</small>}
          </div>
        </div>
        <div
          className={`evalbar${flipped ? ' flipped' : ''}`}
          title="Position evaluation"
          style={hideAnalysis ? { visibility: 'hidden' } : undefined}
        >
          <div className="evalfill" style={{ height: `${whitePct}%` }} />
          <span
            className={`evaltext${whitePct >= 50 !== flipped ? '' : ' top'}${whitePct >= 50 ? '' : ' blackside'}`}
          >
            {formatEval(current)}
          </span>
        </div>
        <div className="board">
          {badge && !hideAnalysis && !editor && (
            <div
              className="badgecell"
              style={{
                left: `${(flipped ? 7 - 'abcdefgh'.indexOf(badge.square[0]) : 'abcdefgh'.indexOf(badge.square[0])) * 12.5}%`,
                top: `${(flipped ? Number(badge.square[1]) - 1 : 8 - Number(badge.square[1])) * 12.5}%`,
              }}
            >
              <span
                className={`badge ${badge.rating}`}
                title={badge.rating === 'pending' ? 'Analyzing…' : RATINGS[badge.rating].label}
              >
                {badge.rating === 'pending' ? '…' : RATINGS[badge.rating].symbol}
              </span>
            </div>
          )}
          {pendingPromo && (
            <div className="promo" role="dialog" aria-label="Choose promotion piece">
              <strong>Promote to:</strong>
              <div className="promo-options">
                {PROMOTIONS.map((p) => (
                  <button
                    key={p.piece}
                    title={p.label}
                    onClick={() => tryMove(pendingPromo.from, pendingPromo.to, p.piece)}
                  >
                    <span className="glyph">{mover === 'w' ? p.white : p.black}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setPendingPromo(null)}>Cancel</button>
            </div>
          )}
          <Chessboard
            options={{
              position: editor
                ? Object.fromEntries(
                    Object.entries(editor.pieces).map(([sq, p]) => [sq, { pieceType: p }]),
                  )
                : fen,
              boardOrientation: flipped ? 'black' : 'white',
              onPieceDrop: editor ? editDrop : onPieceDrop,
              onPieceDrag: editor ? undefined : onPieceDrag,
              onSquareClick: editor ? editClick : onSquareClick,
              squareStyles: editor ? {} : squareStyles,
              arrows: editor ? [] : arrows,
              allowDragOffBoard: true,
              lightSquareNotationStyle: { color: '#6b3f1d' },
              darkSquareNotationStyle: { color: '#fff6e5' },
              alphaNotationStyle: {
                fontWeight: 900,
                fontSize: 15,
                position: 'absolute',
                bottom: 1,
                right: 4,
                userSelect: 'none',
              },
              numericNotationStyle: {
                fontWeight: 900,
                fontSize: 15,
                position: 'absolute',
                top: 2,
                left: 3,
                userSelect: 'none',
              },
              showAnimations: true,
              animationDurationInMs: 250,
              allowDragging: editor ? true : !review && !isOver && game.turn() === mover && !pendingPromo,
            }}
          />
        </div>
        <aside className="side">
          <div className="sidebox">
            <div className="info">
              <div className="pinned">
              <p className="status">
                {review ? (
                  `Reviewing: move ${ply} of ${review.moves.length}`
                ) : engine ? (
                  <Rich text={getStatus(game, player, engineTurn, override)} />
                ) : (
                  'Loading engine...'
                )}
              </p>
              <div className="controls iconbar">
                <button onClick={() => newGame('w')} title="New game as White" aria-label="Play as White">
                  <Icon name="white" />
                </button>
                <button onClick={() => newGame('b')} title="New game as Black" aria-label="Play as Black">
                  <Icon name="black" />
                </button>
                <button
                  onClick={undo}
                  disabled={review !== null || history.length < (override ? 1 : 2)}
                  title="Undo"
                  aria-label="Undo"
                >
                  <Icon name="undo" />
                </button>
                <button
                  onClick={redo}
                  disabled={review !== null || redoStack.length === 0}
                  title="Redo"
                  aria-label="Redo"
                >
                  <Icon name="redo" />
                </button>
                <button
                  onClick={() => (editor ? setEditor(null) : startEditor())}
                  title="Edit board: move, remove or add pieces, then play from the new position"
                  aria-label="Edit board"
                  aria-pressed={editor !== null}
                >
                  <Icon name="edit" />
                </button>
                <button
                  onClick={() => setFlip(!flip)}
                  title="Flip board"
                  aria-label="Flip board"
                  aria-pressed={flip}
                >
                  <Icon name="flip" />
                </button>
                <button
                  onClick={switchSide}
                  disabled={training !== null || editor !== null}
                  title="Switch sides: keep the current position and play the other color"
                  aria-label="Switch sides"
                >
                  <Icon name="swap" />
                </button>
                <button
                  onClick={() => setPgnBox(pgnBox ? null : { text: '', error: null })}
                  title="Import PGN: replay a game from Chess.com or Lichess"
                  aria-label="Import PGN"
                  aria-pressed={pgnBox !== null}
                >
                  <Icon name="file" />
                </button>
                <button
                  onClick={() => {
                    setOverride(!override)
                    setSelected(null)
                    setPendingPromo(null)
                  }}
                  title="Bot override: pause the bot and move its pieces yourself"
                  aria-label="Bot override"
                  aria-pressed={override}
                >
                  <Icon name="bot" />
                </button>
                <button
                  onClick={() => setHintFen(showHint ? null : fen)}
                  disabled={isOver || game.turn() !== mover}
                  title={showHint ? 'Hide hint' : 'Hint'}
                  aria-label="Hint"
                  aria-pressed={showHint}
                >
                  <Icon name="hint" />
                </button>
                <button
                  onClick={() => {
                    setMuted(!mute)
                    setMute(!mute)
                  }}
                  title={mute ? 'Unmute sound effects' : 'Mute sound effects'}
                  aria-label="Sound"
                >
                  <Icon name={mute ? 'soundOff' : 'soundOn'} />
                </button>
                <button
                  onClick={() => setOptionsFen(showOptions ? null : fen)}
                  disabled={isOver || game.turn() !== mover || editor !== null}
                  title="Move options: sample moves from best to blunder"
                  aria-label="Move options"
                  aria-pressed={showOptions}
                >
                  <Icon name="options" />
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('practice', practice ? '0' : '1')
                    setPractice(!practice)
                  }}
                  title="Practice mode: hides the evaluation bar, move ratings, and accuracy until the game ends"
                  aria-label="Practice"
                  aria-pressed={practice}
                >
                  <Icon name={practice ? 'eyeOff' : 'eye'} />
                </button>
                <label title="Approximate strength; actual play depends on your device and the engine's thinking time">
                  Level: {skill} (~{approxElo(skill)} Elo)
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={skill}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      localStorage.setItem('skill', String(v))
                      setSkill(v)
                    }}
                  />
                </label>
              </div>
              </div>
              {pgnBox && (
                <div className="editor">
                  <strong>Import PGN</strong>
                  <p>Paste a game from Chess.com or Lichess to replay it with move ratings.</p>
                  <textarea
                    className="pgn"
                    rows={6}
                    value={pgnBox.text}
                    placeholder="1. e4 e5 2. Nf3 Nc6 ..."
                    onChange={(e) => setPgnBox({ text: e.target.value, error: null })}
                  />
                  <div className="controls">
                    <button onClick={() => openReview(pgnBox.text)} disabled={!pgnBox.text.trim()}>
                      Load game
                    </button>
                    <button onClick={() => setPgnBox(null)}>Cancel</button>
                  </div>
                  {pgnBox.error && <p className="notice">{pgnBox.error}</p>}
                </div>
              )}
              {review && (
                <div className="editor">
                  <strong>Game review</strong>
                  <p>
                    {review.white} vs {review.black} · {review.result}
                  </p>
                  <div className="controls">
                    <button onClick={() => goTo(0)} disabled={ply === 0} title="First position" aria-label="First position">
                      «
                    </button>
                    <button onClick={() => goTo(ply - 1)} disabled={ply === 0} title="Previous move" aria-label="Previous move">
                      ‹
                    </button>
                    <button
                      onClick={() => goTo(ply + 1)}
                      disabled={ply === review.moves.length}
                      title="Next move"
                      aria-label="Next move"
                    >
                      ›
                    </button>
                    <button
                      onClick={() => goTo(review.moves.length)}
                      disabled={ply === review.moves.length}
                      title="Last position"
                      aria-label="Last position"
                    >
                      »
                    </button>
                    <button onClick={() => newGame(player)}>Exit review</button>
                  </div>
                </div>
              )}
              {editor && (
                <div className="editor">
                  <strong>Edit board</strong>
                  <p>
                    Pick a piece, then click squares to place it. Drag pieces to move them; drag one off the
                    board to remove it.
                  </p>
                  <div className="palette">
                    {(['w', 'b'] as Color[]).map((c) => (
                      <div key={c} className="palette-row">
                        {PALETTE_TYPES.map((t) => {
                          const code = c + t
                          return (
                            <button
                              key={code}
                              onClick={() => patchEditor({ tool: editor.tool === code ? null : code })}
                              aria-pressed={editor.tool === code}
                              title={`${c === 'w' ? 'White' : 'Black'} ${t}`}
                            >
                              {GLYPH[c][t.toLowerCase()]}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                    <div className="palette-row">
                      <button
                        className="wide"
                        onClick={() => patchEditor({ tool: editor.tool === 'erase' ? null : 'erase' })}
                        aria-pressed={editor.tool === 'erase'}
                      >
                        Eraser
                      </button>
                    </div>
                  </div>
                  <div className="controls">
                    <button onClick={() => patchEditor({ turn: 'w' })} aria-pressed={editor.turn === 'w'}>
                      White to move
                    </button>
                    <button onClick={() => patchEditor({ turn: 'b' })} aria-pressed={editor.turn === 'b'}>
                      Black to move
                    </button>
                  </div>
                  <div className="controls">
                    <button onClick={startEditor}>Reset</button>
                    <button
                      onClick={() => {
                        const std = new Chess()
                        const pieces: Record<string, string> = {}
                        for (const row of std.board()) {
                          for (const sq of row) if (sq) pieces[sq.square] = sq.color + sq.type.toUpperCase()
                        }
                        patchEditor({ pieces, turn: 'w' })
                      }}
                    >
                      Start position
                    </button>
                    <button onClick={() => patchEditor({ pieces: {} })}>Clear</button>
                    <button onClick={applyEditor}>Play from here</button>
                    <button onClick={() => setEditor(null)}>Cancel</button>
                  </div>
                  {editor.error && <p className="notice">{editor.error}</p>}
                </div>
              )}
              <div className="trainer">
                <strong>Opening trainer</strong>
                {training && line ? (
                  <>
                    <p>
                      {line.name}:{' '}
                      {inLine
                        ? `move ${Math.floor(ply / 2) + 1} of ${Math.ceil(line.moves.length / 2)}`
                        : 'line complete! Keep playing or pick another opening.'}{' '}
                      · mistakes: {training.mistakes}
                    </p>
                    {notice && (
                      <p className="notice">
                        <Rich text={notice} />
                      </p>
                    )}
                    <button onClick={stopTraining}>{inLine ? 'Stop training' : 'Finish'}</button>
                  </>
                ) : (
                  <div className="controls">
                    <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                      {LINES.map((l, i) => (
                        <option key={l.name} value={i}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => startTraining(pick, 'w')}>Train as White</button>
                    <button onClick={() => startTraining(pick, 'b')}>Train as Black</button>
                  </div>
                )}
              </div>
              {feedback && !hideAnalysis && <p className="feedback">
                  <Rich text={feedback} />
                </p>}
              {showOptions && (
                <div className="hint options">
                  <strong>Move options</strong>
                  {!optItems ? (
                    <p>Analyzing every legal move...</p>
                  ) : (
                    <ul>
                      {optItems.map((o) => (
                        <li key={o.uci}>
                          <button
                            className={optPick?.uci === o.uci ? 'picked' : ''}
                            style={{ borderLeftColor: RATING_COLOR[o.review.rating] }}
                            onClick={() => setOptPick(optPick?.uci === o.uci ? null : { fen, uci: o.uci })}
                            title="Show this move on the board"
                          >
                            <b>{o.san}</b> {RATINGS[o.review.rating].symbol} {RATINGS[o.review.rating].label}
                            <small> {formatEval(o.eval)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {showHint && (
                <div className="hint">
                  <p>
                    <strong>{hintBook ? 'Book move:' : 'Best move:'}</strong>{' '}
                    {hintSan ? <Rich text={hintSan} /> : hintBest ? hintBest : 'calculating...'}
                  </p>
                  {hintWhy.length > 0 && (
                    <>
                      <strong>Why:</strong>
                      <ul>
                        {hintWhy.map((r) => (
                          <li key={r}>
                            <Rich text={r} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {threats.length === 0 ? (
                    <p>No pieces of yours are under threat.</p>
                  ) : (
                    <>
                      <strong>Threatened pieces:</strong>
                      <ul>
                        {threats.map((t) => (
                          <li key={t.square}>
                            <Rich text={t.text} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {opening && (
                <div className="opening">
                  <strong>
                    {opening.name} <small>({opening.eco})</small>
                  </strong>
                  {outOfBook && <small> (out of book after move {openingPly + 1})</small>}
                  {explain(opening.name) && (
                    <p>
                      <Rich text={explain(opening.name)!} />
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="movesbox" ref={sideRef}>
              <div className="accuracy">
                {hideAnalysis ? (
                  'Analysis hidden (practice mode). It is revealed when the game ends.'
                ) : (
                  <>
                    <div className="statrow">
                      <span className="statlabel">Accuracy</span>
                      <span>
                        White <b className="stat">{averageAccuracy(allReviews, allHistory, 'w')}</b>
                      </span>
                      <span>
                        Black <b className="stat">{averageAccuracy(allReviews, allHistory, 'b')}</b>
                      </span>
                    </div>
                    <div className="statrow">
                      <span className="statlabel">Est. Elo</span>
                      <span>
                        White <b className="stat">{estimateElo(evals, allHistory, 'w')}</b>
                      </span>
                      <span>
                        Black <b className="stat">{estimateElo(evals, allHistory, 'b')}</b>
                      </span>
                    </div>
                  </>
                )}
              </div>
              <table className="moves">
                <tbody>
                  {rows.map((i) => (
                    <tr key={i}>
                      <th>{(i + offset) / 2 + 1}.</th>
                      {cell(i)}
                      {cell(i + 1)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
