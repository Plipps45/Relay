/*
 * Generated workspace names pair a quality with something that carries a
 * signal along (amber-beacon, swift-uplink): short, readable as a branch and
 * folder name, and with enough combinations that reuse is rare.
 */
export const NAME_QUALITIES = [
  'amber', 'azure', 'bold', 'brisk', 'bright', 'calm', 'clear', 'cobalt',
  'crimson', 'crisp', 'eager', 'early', 'fleet', 'gentle', 'golden', 'indigo',
  'ivory', 'jade', 'keen', 'lucid', 'lunar', 'mellow', 'nimble', 'onyx',
  'quiet', 'rapid', 'ruby', 'scarlet', 'silver', 'solar', 'steady', 'swift',
  'tidy', 'vivid', 'warm', 'young'
] as const

export const NAME_CARRIERS = [
  'antenna', 'arc', 'baton', 'beacon', 'bridge', 'cable', 'carrier', 'channel',
  'circuit', 'coil', 'comet', 'compass', 'courier', 'current', 'dial', 'flare',
  'frame', 'junction', 'lantern', 'lens', 'link', 'meridian', 'modem', 'node',
  'orbit', 'packet', 'prism', 'pulse', 'radar', 'relay', 'repeater', 'router',
  'signal', 'socket', 'spark', 'station', 'switch', 'tower', 'transit', 'uplink',
  'vector', 'vertex', 'waypoint', 'wire'
] as const

export const WORKSPACE_NAMES: readonly string[] = NAME_QUALITIES.flatMap((quality) => NAME_CARRIERS.map((carrier) => `${quality}-${carrier}`))

export function normalizeWorkspaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

/**
 * Picks an unused name at random. Retired names count as used: agent CLIs key
 * conversation history by cwd, so reissuing a deleted workspace path leaks old history.
 * Once every base name is spent the pool degrades to suffixed tiers (name-2, name-3).
 */
export function suggestWorkspaceName(usedNames: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set<string>()
  for (const name of usedNames) {
    used.add(name.trim().toLowerCase())
  }
  for (let tier = 1; ; tier += 1) {
    const available = WORKSPACE_NAMES.map((name) => (tier === 1 ? name : `${name}-${tier}`)).filter((name) => !used.has(name))
    if (available.length > 0) {
      return available[Math.floor(random() * available.length)]
    }
  }
}
