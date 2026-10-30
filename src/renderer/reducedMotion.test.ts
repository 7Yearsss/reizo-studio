import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'index.css'), 'utf8').replaceAll('\r\n', '\n')

const blockStart = css.indexOf('@media (prefers-reduced-motion: reduce)')
const blockEnd = css.indexOf('\n}\n', blockStart)
const reduced = css.slice(blockStart, blockEnd)
const outside = css.slice(0, blockStart) + css.slice(blockEnd)

/** Keyframes the global safety net deliberately leaves to a rule outside the media query. */
const SAFETY_NET_ONLY: Record<string, string> = {
  'pulse-subtle': 'a status pulse; the catch-all stops it, an explicit rule would add nothing',
}

describe('reduced-motion registration', () => {
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])

  it('finds the reduced-motion block and the keyframes', () => {
    expect(blockStart).toBeGreaterThan(0)
    expect(names.length).toBeGreaterThan(5)
  })

  it.each(names)('keyframe %s has an explicit reduced-motion rule or a stated exemption', (name) => {
    if (SAFETY_NET_ONLY[name]) return
    // The class that runs it: the selector of the rule whose declarations use `animation: <name>`.
    const users = [...outside.matchAll(new RegExp(String.raw`([^{}]+)\{[^{}]*animation:\s*${name}\b`, 'g'))]
    const selectors = users
      .flatMap((m) => m[1].split(',').map((s) => s.trim()))
      .flatMap((s) => [...s.matchAll(/\.([\w-]+)/g)].map((c) => c[1]))
    const covered =
      reduced.includes(name) || selectors.some((cls) => reduced.includes(`.${cls}`))
    expect(covered, `@keyframes ${name} (used by ${selectors.join(', ') || 'nothing'})`).toBe(true)
  })
})
