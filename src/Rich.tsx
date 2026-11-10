const SQUARE = /\b((?:[KQRBN][a-h1-8]?x?|[a-h]x)?[a-h][1-8])\b/g

export function Rich({ text }: { text: string }) {
  const parts = text.split(SQUARE)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="sq">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}
