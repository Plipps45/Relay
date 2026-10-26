function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(value.trim())
  return match ? match[1].split('.').map(Number) : null
}

/** True when `candidate` (a release tag such as "v0.1.2") is a later version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const now = parseVersion(current)
  if (!next || !now) {
    return false
  }
  for (let i = 0; i < Math.max(next.length, now.length); i++) {
    const diff = (next[i] ?? 0) - (now[i] ?? 0)
    if (diff !== 0) {
      return diff > 0
    }
  }
  return false
}
