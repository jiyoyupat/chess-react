export type Opening = { eco: string; name: string }
export type OpeningDb = Record<string, [string, string]>

let dbPromise: Promise<OpeningDb> | null = null

// Large dataset (~460KB), loaded lazily so it does not slow down the first render.
export function loadOpenings(): Promise<OpeningDb> {
  dbPromise ??= import('./openings.json').then((m) => m.default as unknown as OpeningDb)
  return dbPromise
}

const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

// Find the opening for a position (ignores move counters, so transpositions match too).
export function lookup(db: OpeningDb, fen: string): Opening | null {
  const hit = db[key(fen)]
  return hit ? { eco: hit[0], name: hit[1] } : null
}

// Key = opening name prefix, matched by the longest prefix.
const EXPLANATIONS: Record<string, string> = {
  'Italian Game':
    "White eyes f7 (Black's weakest point) with the bishop on c4. Plan: develop, castle, then c3 + d4 to take the center. Open and easy to understand.",
  'Ruy Lopez':
    "The bishop on b5 pressures the knight that defends e5. White does not rush; pressure builds slowly. A classic, strategic opening.",
  'Scotch Game':
    'White opens the center immediately with d4. The result is an open position with active pieces; Black must defend accurately.',
  'Four Knights Game':
    'All knights are developed first. Symmetrical, solid, and low-risk; good for learning basic development.',
  'Vienna Game':
    'White develops the b1 knight before the g1 knight, preparing f4. Flexible and a little sharp.',
  "Bishop's Opening":
    'Bishop to c4 before the knight. Quickly pressures f7 and keeps many transposition options open.',
  "King's Gambit":
    "White sacrifices the f-pawn to open the f-file and control the center. Very sharp and risky, but often leads to quick attacks.",
  "Petrov's Defense":
    'Black counterattacks e4 with ...Nf6 instead of defending e5. Very solid and drawish.',
  'Philidor Defense':
    'Black defends e5 with ...d6. Solid but passive; Black has less space.',
  'Sicilian Defense':
    "Black answers e4 with ...c5, creating an asymmetrical structure. White usually attacks on the kingside, Black on the queenside. Sharp, with winning chances for both sides. Famous variations: Najdorf, Dragon, Sveshnikov.",
  'French Defense':
    "Black plays ...e6 then ...d5 and builds a solid pawn chain. The problem is the c8 bishop is often locked in. Black's plan: attack White's center with ...c5 and ...f6.",
  'Caro-Kann Defense':
    'Like the French, but the c8 bishop is developed first. Very solid with a healthy pawn structure; suits patient players.',
  'Scandinavian Defense':
    'Black challenges e4 immediately with ...d5. The queen comes out early (...Qxd5), so watch tempo and development.',
  'Alekhine Defense':
    'Black deliberately lures White\'s pawns forward and then attacks them as targets. Hypermodern: control the center from a distance.',
  'Pirc Defense':
    'Black lets White build a big center, then attacks it with ...g6, ...Bg7, and ...c5/...e5. Flexible but requires technique.',
  'Modern Defense':
    'Similar to the Pirc: the g7 bishop pressures the center from afar. Black waits for the right moment to strike at the center.',
  "Queen's Gambit Accepted":
    'Black takes the c4 pawn. White does not rush to win it back; it prioritizes the center and development.',
  "Queen's Gambit Declined":
    'Black declines the pawn and holds d5 with ...e6. Very solid; a great place to learn pawn structures.',
  'Slav Defense':
    'Black supports d5 with ...c6 so the c8 bishop can develop. Solid, strong structure, and lots of theory.',
  'Semi-Slav Defense':
    'A mix of the Slav and QGD (...c6 + ...e6). Very complex and sharp, but Black\'s structure is sturdy.',
  "King's Indian Defense":
    "Black lets White take the center, develops the bishop to g7, then strikes the center with ...e5/...c5 and usually attacks on the kingside. Dynamic and aggressive.",
  'Grünfeld Defense':
    "Black attacks White's center directly with ...d5 after ...g6. White gets a big center, but Black pressures it with ...Bg7 and play against c3/d4.",
  'Nimzo-Indian Defense':
    'The bishop on b4 pins the c3 knight and stops e4. Flexible; one of Black\'s best defenses against 1.d4.',
  "Queen's Indian Defense":
    'Black develops the bishop to b7 to watch e4. Solid and calm, but slightly passive.',
  'Dutch Defense':
    "Black meets 1.d4 with ...f5 to control e4. Aggressive but weakens the king.",
  'Benoni Defense':
    'Black gives up space in the center for counterplay on the queenside. Asymmetrical and sharp.',
  'English Opening':
    'White starts with c4 to control d5 from the side. Flexible and strategic; often transposes into other openings.',
  'Réti Opening':
    "Knight to f3 and c4 without building the center right away. Hypermodern: attack the center from afar, then build your own.",
  'Zukertort Opening':
    'Knight to f3 first. Very flexible and can transpose into many openings.',
  'Catalan Opening':
    "The bishop on g2 pressures b7 and the queenside. Quiet but very pressing; White keeps long-term pressure.",
  'London System':
    'White builds a fixed setup: d4, Nf3, Bf4, e3, c3. Almost no theory, so it is easy to memorize and solid. Great for beginners.',
  'Colle System':
    'A quiet setup: d4, Nf3, e3, Bd3, c3, then a strong e4. Easy to learn with clear attacking patterns.',
  "Queen's Pawn Game":
    'White starts with d4 to control the center. Usually calmer and more positional than 1.e4.',
  "King's Pawn Game":
    'White starts with e4 to open lines for the bishop and queen and to control the center.',
  'Bird Opening':
    "White plays f4 to control e5. Aggressive but weakens White's own king.",
  'Trompowsky Attack':
    "Bishop to g5 early to disrupt Black's development. Easy to understand but catches unprepared opponents.",
  'Englund Gambit':
    'Black sacrifices a pawn on move 1 for quick traps. Risky, and not recommended if White plays correctly.',
}

const PREFIXES = Object.keys(EXPLANATIONS).sort((a, b) => b.length - a.length)

export function explain(name: string): string | null {
  const hit = PREFIXES.find((p) => name === p || name.startsWith(`${p}:`) || name.startsWith(`${p},`))
  return hit ? EXPLANATIONS[hit] : null
}
