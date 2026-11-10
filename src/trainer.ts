// Opening lines for the trainer. Moves are SAN, starting from the initial position.
export type Line = { name: string; moves: string[] }

export const LINES: Line[] = [
  {
    name: 'Italian Game (Giuoco Piano)',
    moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 Nxe4 O-O Bxc3 d5 Bf6 Re1 Ne7 Rxe4 d6'.split(' '),
  },
  {
    name: 'Ruy Lopez (Closed)',
    moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7'.split(' '),
  },
  {
    name: 'Scotch Game',
    moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6'.split(' '),
  },
  {
    name: 'Petrov\'s Defense',
    moves: 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7 c4 Nb4 Be2 O-O Nc3 Bf5'.split(' '),
  },
  {
    name: 'Sicilian Defense (Najdorf)',
    moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7'.split(' '),
  },
  {
    name: 'French Defense (Classical)',
    moves: 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5 dxc5 Nc6'.split(' '),
  },
  {
    name: 'Caro-Kann Defense (Classical)',
    moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6'.split(' '),
  },
  {
    name: 'Scandinavian Defense',
    moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6 Nd5 Qd8'.split(' '),
  },
  {
    name: "Queen's Gambit Declined",
    moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5'.split(' '),
  },
  {
    name: 'Slav Defense',
    moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O Qe2 Nbd7'.split(' '),
  },
  {
    name: 'London System',
    moves: 'd4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Nbd2 c5 c3 Nc6 Bd3 b6'.split(' '),
  },
  {
    name: "King's Indian Defense (Classical)",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7'.split(' '),
  },
  {
    name: 'Nimzo-Indian Defense (Rubinstein)',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7'.split(' '),
  },
  {
    name: 'English Opening (Reversed Sicilian)',
    moves: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3 O-O'.split(' '),
  },
]

/** Strip check/mate/annotation marks so "Bb4+" matches "Bb4". */
export const plain = (san: string) => san.replace(/[+#!?]/g, '')
