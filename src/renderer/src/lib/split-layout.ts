import type { SplitNode } from '@shared/types'

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function paneIds(node: SplitNode): string[] {
  return node.type === 'pane' ? [node.paneId] : node.children.flatMap(paneIds)
}

/** Replace `targetPaneId` with a split holding it and `newPaneId`, nesting only when the direction changes. */
export function splitPane(
  node: SplitNode,
  targetPaneId: string,
  newPaneId: string,
  direction: 'row' | 'column'
): SplitNode {
  if (node.type === 'pane') {
    if (node.paneId !== targetPaneId) {
      return node
    }
    return {
      type: 'split',
      direction,
      children: [node, { type: 'pane', paneId: newPaneId }],
      sizes: [0.5, 0.5]
    }
  }
  const index = node.children.findIndex((child) => child.type === 'pane' && child.paneId === targetPaneId)
  if (index !== -1 && node.direction === direction) {
    const children = [...node.children]
    children.splice(index + 1, 0, { type: 'pane', paneId: newPaneId })
    const share = node.sizes[index] / 2
    const sizes = [...node.sizes]
    sizes.splice(index, 1, share, share)
    return { ...node, children, sizes }
  }
  return { ...node, children: node.children.map((child) => splitPane(child, targetPaneId, newPaneId, direction)) }
}

/** Remove a pane and collapse any split left with a single child. Returns null when nothing remains. */
export function removePane(node: SplitNode, paneId: string): SplitNode | null {
  if (node.type === 'pane') {
    return node.paneId === paneId ? null : node
  }
  const kept: SplitNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const next = removePane(child, paneId)
    if (next) {
      kept.push(next)
      sizes.push(node.sizes[i])
    }
  })
  if (kept.length === 0) {
    return null
  }
  if (kept.length === 1) {
    return kept[0]
  }
  const total = sizes.reduce((a, b) => a + b, 0)
  return { ...node, children: kept, sizes: sizes.map((s) => s / total) }
}

export function setSplitSizes(node: SplitNode, path: number[], sizes: number[]): SplitNode {
  if (node.type === 'pane') {
    return node
  }
  if (path.length === 0) {
    return { ...node, sizes }
  }
  const [head, ...rest] = path
  return {
    ...node,
    children: node.children.map((child, i) => (i === head ? setSplitSizes(child, rest, sizes) : child))
  }
}

/** Nearest pane in a direction, used for keyboard pane focus. Falls back to list order. */
export function neighborPane(node: SplitNode, paneId: string, offset: 1 | -1): string {
  const ids = paneIds(node)
  const index = ids.indexOf(paneId)
  return ids[(index + offset + ids.length) % ids.length] ?? paneId
}
