import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'
import type { SearchResult } from './engine'

/** Position evaluation from White's point of view. */
export type Analysis = {
  cp: number // centipawns; mate scores are converted to +/-10000
  mate: number | null // positive: White mates in n; negative: Black mates in n; 0: already checkmate
  best: string | null // best move (UCI) from this position
}

export type Rating = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export const RATINGS: Record<Rating, { label: string; symbol: string }> = {
  best: { label: 'Best', symbol: '★' },
  excellent: { label: 'Excellent', symbol: '!' },
  good: { label: 'Good', symbol: '✓' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!' },
  mistake: { label: 'Mistake', symbol: '?' },
  blunder: { label: 'Blunder', symbol: '??' },
}

const MATE_CP = 10000

export function toAnalysis(fen: string, r: SearchResult): Analysis {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1
  const s = r.score
  if (!s) return { cp: 0, mate: null, best: r.move }
  if (s.mate !== null) {
    return { cp: sign * Math.sign(s.mate) * MATE_CP, mate: sign * s.mate, best: r.move }
  }
  return { cp: sign * s.cp, mate: null, best: r.move }
}

/** Finished positions do not need engine analysis. */
export function terminalAnalysis(fen: string): Analysis | null {
  const g = new Chess(fen)
  if (g.isCheckmate()) {
    return { cp: g.turn() === 'w' ? -MATE_CP : MATE_CP, mate: 0, best: null }
  }
  if (g.isDraw()) return { cp: 0, mate: null, best: null }
  return null
}

/** White's win chance (0-100), same formula as Lichess. */
export function winPct(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export type MoveReview = { rating: Rating; loss: number; accuracy: number; best: string | null }

export function rateMove(
  color: 'w' | 'b',
  uci: string,
  before: Analysis,
  after: Analysis,
): MoveReview {
  const sign = color === 'w' ? 1 : -1
  const loss = Math.max(0, winPct(sign * before.cp) - winPct(sign * after.cp))
  let rating: Rating
  if (uci === before.best || loss < 0.5) rating = 'best'
  else if (loss < 2) rating = 'excellent'
  else if (loss < 5) rating = 'good'
  else if (loss < 10) rating = 'inaccuracy'
  else if (loss < 20) rating = 'mistake'
  else rating = 'blunder'
  const accuracy = Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669))
  return { rating, loss, accuracy, best: before.best }
}

export function formatEval(a: Analysis | undefined): string {
  if (!a) return '...'
  if (a.mate === 0) return a.cp > 0 ? '1-0' : '0-1'
  if (a.mate !== null) return `${a.mate > 0 ? '+' : '-'}M${Math.abs(a.mate)}`
  const v = a.cp / 100
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
}

export function uciToSan(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    }).san
  } catch {
    return null
  }
}

const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }
const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

export type Threat = { square: Square; text: string }

/**
 * Pieces of `color` that the opponent can capture profitably: the piece is either
 * undefended, or attacked by a cheaper piece. (Does not look at pins or exchange sequences.)
 */
export function findThreats(game: Chess, color: Color): Threat[] {
  const opponent: Color = color === 'w' ? 'b' : 'w'
  const threats: Threat[] = []
  for (const row of game.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'k') continue
      const attackers = game.attackers(p.square, opponent)
      if (attackers.length === 0) continue
      const cheapest = attackers
        .map((s) => game.get(s)!)
        .reduce((a, b) => (PIECE_VALUE[a.type] <= PIECE_VALUE[b.type] ? a : b))
      const defended = game.attackers(p.square, color).length > 0
      if (defended && PIECE_VALUE[cheapest.type] >= PIECE_VALUE[p.type]) continue
      const reason = defended ? 'attacked by a cheaper piece' : 'undefended'
      threats.push({
        square: p.square,
        text: `${PIECE_NAME[p.type]} on ${p.square} is attacked by a ${PIECE_NAME[cheapest.type]} (${reason})`,
      })
    }
  }
  return threats
}

/**
 * Heuristic explanation of why a move is good, built from concrete features of the move
 * (captures, checks, threats, development...) plus the engine evaluation when available.
 */
export function explainMove(fen: string, uci: string, evalNow?: Analysis): string[] {
  const g = new Chess(fen)
  const mover = g.turn()
  const opp: Color = mover === 'w' ? 'b' : 'w'
  const threatsBefore = findThreats(g, mover)
  const plyBefore = (Number(fen.split(' ')[5]) - 1) * 2 + (mover === 'b' ? 1 : 0)
  let move
  try {
    move = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return []
  }
  const reasons: string[] = []
  const name = PIECE_NAME[move.piece]

  if (g.isCheckmate()) reasons.push('It delivers checkmate.')
  else if (g.inCheck()) reasons.push('It gives check, forcing the opponent to respond.')

  if (move.captured) {
    const free = g.attackers(move.to, opp).length === 0
    reasons.push(
      free
        ? `It captures the ${PIECE_NAME[move.captured]} on ${move.to}, and your ${name} is safe there, so you win material.`
        : `It captures the ${PIECE_NAME[move.captured]} on ${move.to}. The ${name} can be recaptured, but the engine judges the exchange favorable.`,
    )
  }

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    reasons.push('Castling puts your king in safety and brings a rook toward the center.')
  }
  if (move.promotion) reasons.push(`It promotes the pawn to a ${PIECE_NAME[move.promotion]}.`)

  if (threatsBefore.some((t) => t.square === move.from)) {
    reasons.push(`It moves your ${name} out of danger: on ${move.from} it was under attack.`)
  } else {
    const threatsAfter = findThreats(g, mover).map((t) => t.square)
    const fixed = threatsBefore.find((t) => !threatsAfter.includes(t.square))
    if (fixed) reasons.push(`It resolves the threat against your ${fixed.text.split(' is attacked')[0]}.`)
  }

  // Targets the moved piece now attacks that are undefended or worth more than the attacker.
  const targets: string[] = []
  for (const row of g.board()) {
    for (const p of row) {
      if (!p || p.color !== opp || p.type === 'k') continue
      if (move.captured && p.square === move.to) continue
      if (!g.attackers(p.square, mover).includes(move.to)) continue
      const undefended = g.attackers(p.square, opp).length === 0
      if (undefended || PIECE_VALUE[p.type] > PIECE_VALUE[move.piece]) {
        targets.push(`${PIECE_NAME[p.type]} on ${p.square}`)
      }
    }
  }
  if (targets.length >= 2) reasons.push(`It attacks two pieces at once: the ${targets.join(' and the ')}.`)
  else if (targets.length === 1) reasons.push(`It attacks the ${targets[0]}.`)

  if (plyBefore < 24) {
    const homeRank = mover === 'w' ? '1' : '8'
    if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === homeRank) {
      reasons.push(`It develops your ${name}, getting a minor piece into the game.`)
    }
    if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to)) {
      reasons.push('It claims central space, which gives your pieces more room.')
    } else if (move.piece === 'p' && ['c4', 'c5', 'f4', 'f5'].includes(move.to)) {
      reasons.push('It fights for the center from the side.')
    }
  }

  if (evalNow) {
    const sign = mover === 'w' ? 1 : -1
    if (evalNow.mate !== null && evalNow.mate !== 0) {
      reasons.push(
        sign * evalNow.mate > 0
          ? `The engine sees a forced checkmate in ${Math.abs(evalNow.mate)}.`
          : `You are facing a forced mate in ${Math.abs(evalNow.mate)}; this move holds out the longest.`,
      )
    } else if (evalNow.mate === null) {
      const v = (sign * evalNow.cp) / 100
      if (Math.abs(v) < 0.3) reasons.push('The position is roughly equal; this keeps the balance.')
      else if (v > 0) reasons.push(`You are better (+${v.toFixed(2)}); this move keeps your advantage.`)
      else reasons.push(`You are worse (${v.toFixed(2)}); this is the most resilient defense.`)
    }
  }

  if (reasons.length === 0) {
    reasons.push(
      'A quiet positional move: no tactics, but the engine prefers the better placement of your pieces and pawn structure.',
    )
  }
  return reasons
}
