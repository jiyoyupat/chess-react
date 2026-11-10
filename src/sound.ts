// Sound effects synthesized with the Web Audio API (no audio files needed).
let ctx: AudioContext | null = null
let muted = localStorage.getItem('muted') === '1'

export const isMuted = () => muted

export function setMuted(value: boolean) {
  muted = value
  localStorage.setItem('muted', value ? '1' : '0')
}

function audio(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, dur: number, gain: number, when = 0, type: OscillatorType = 'sine', endFreq = freq) {
  const c = audio()
  const t = c.currentTime + when
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur)
}

function click(dur: number, gain: number, filterFreq: number, when = 0) {
  const c = audio()
  const t = c.currentTime + when
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = filterFreq
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t)
}

export type MoveSound = 'move' | 'capture' | 'castle' | 'check'

export function playMove(kind: MoveSound) {
  if (muted) return
  switch (kind) {
    case 'move':
      click(0.05, 0.9, 1800)
      tone(220, 0.08, 0.35, 0, 'sine', 110)
      break
    case 'capture':
      click(0.1, 1.2, 1200)
      tone(160, 0.12, 0.5, 0, 'triangle', 70)
      break
    case 'castle':
      click(0.05, 0.9, 1800)
      click(0.05, 0.9, 1500, 0.12)
      tone(220, 0.08, 0.3, 0, 'sine', 110)
      tone(200, 0.08, 0.3, 0.12, 'sine', 100)
      break
    case 'check':
      click(0.06, 1, 1800)
      tone(880, 0.12, 0.3, 0.02, 'square', 880)
      tone(1174, 0.14, 0.25, 0.12, 'square', 1174)
      break
  }
}

export function playGameEnd(result: 'win' | 'loss' | 'draw') {
  if (muted) return
  const notes = {
    win: [523, 659, 784, 1047],
    loss: [392, 330, 262, 196],
    draw: [440, 440],
  }[result]
  notes.forEach((f, i) => tone(f, 0.25, 0.3, i * 0.15, 'triangle'))
}
