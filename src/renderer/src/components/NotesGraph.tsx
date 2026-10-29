import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useIsDark } from '@/lib/theme'

export type GraphNode = { id: string; label: string }
export type GraphEdge = { source: string; target: string }

// Notes farther apart than this don't repel each other.
const CUTOFF = 500

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number; degree: number; group: number; fixed: boolean }

// Fields left out fall back to the app theme. Nodes are coloured by the folder they sit in.
export type GraphSkin = { id: string; label: string; background?: string; edge?: string; text?: string; accent: string; nodes?: string[] }

export const GRAPH_SKINS: GraphSkin[] = [
  { id: 'default', label: 'Default', accent: '#8b5cf6' },
  { id: 'ocean', label: 'Ocean', background: '#0b1622', edge: '#1e3a5f', text: '#cfe8ff', accent: '#f472b6', nodes: ['#22d3ee', '#3b82f6', '#14b8a6', '#60a5fa', '#a5f3fc'] },
  { id: 'forest', label: 'Forest', background: '#0f1a12', edge: '#2a3d2c', text: '#dcfce7', accent: '#facc15', nodes: ['#4ade80', '#84cc16', '#22c55e', '#a3e635', '#6ee7b7'] },
  { id: 'sunset', label: 'Sunset', background: '#1c1017', edge: '#4a2533', text: '#ffe4e6', accent: '#fde047', nodes: ['#fb7185', '#f97316', '#f59e0b', '#e879f9', '#fda4af'] },
  { id: 'neon', label: 'Neon', background: '#05050a', edge: '#26263a', text: '#f5f5ff', accent: '#ffffff', nodes: ['#ff2bd6', '#00f0ff', '#a3ff00', '#ffe600', '#7c4dff'] },
  { id: 'paper', label: 'Paper', background: '#f7f3ea', edge: '#ddd3c0', text: '#3b3226', accent: '#c2410c', nodes: ['#7c6f5b', '#4f7a6a', '#6f5b8c', '#8c5b5b', '#5b6f8c'] }
]

function folderGroup(path: string): number {
  const slash = path.lastIndexOf('/')
  if (slash < 0) {
    return 0
  }
  let hash = 0
  for (let i = 0; i < slash; i += 1) {
    hash = (hash * 31 + path.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Obsidian-style graph view: a small force simulation on a canvas. Repulsion
 * only looks at nearby grid cells, so large vaults stay interactive.
 */
export function NotesGraph({
  nodes,
  edges,
  activeId,
  visible,
  skin,
  onOpen
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  activeId: string | null
  visible: boolean
  skin: GraphSkin
  onOpen: (id: string) => void
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  // warming: the layout is still being computed off-screen and nothing is drawn yet.
  const simRef = useRef<{ nodes: SimNode[]; byId: Map<string, SimNode>; links: Array<[SimNode, SimNode]>; alpha: number; warming: boolean }>({
    nodes: [],
    byId: new Map(),
    links: [],
    alpha: 1,
    warming: true
  })
  const [progress, setProgress] = useState<number | null>(0)
  const view = useRef({ x: 0, y: 0, scale: 1 })
  const hover = useRef<SimNode | null>(null)
  const wake = useRef<() => void>(() => undefined)
  const isDark = useIsDark()

  // Rebuild the simulation when the vault changes, keeping positions of known notes.
  useEffect(() => {
    const previous = simRef.current.byId
    const byId = new Map<string, SimNode>()
    const count = Math.max(nodes.length, 1)
    nodes.forEach((node, i) => {
      const old = previous.get(node.id)
      const angle = (i / count) * Math.PI * 2
      const radius = 40 + Math.sqrt(count) * 18 * Math.random()
      byId.set(node.id, {
        ...node,
        x: old?.x ?? Math.cos(angle) * radius,
        y: old?.y ?? Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        degree: 0,
        group: folderGroup(node.id),
        fixed: false
      })
    })
    const links: Array<[SimNode, SimNode]> = []
    for (const edge of edges) {
      const a = byId.get(edge.source)
      const b = byId.get(edge.target)
      if (a && b && a !== b) {
        links.push([a, b])
        a.degree += 1
        b.degree += 1
      }
    }
    const warming = !previous.size || simRef.current.warming
    simRef.current = { nodes: [...byId.values()], byId, links, alpha: previous.size ? 0.5 : 1, warming }
    wake.current()
  }, [nodes, edges])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visible) {
      return undefined
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return undefined
    }
    let frame = 0
    let running = false
    const colors = {
      nodes: skin.nodes ?? [cssVar('--muted-foreground', '#888')],
      text: skin.text ?? cssVar('--foreground', '#000'),
      edge: skin.edge ?? cssVar('--border', '#ddd'),
      active: skin.accent,
      background: skin.background ?? cssVar('--background', '#fff')
    }

    const radius = (node: SimNode): number => 3 + Math.min(10, Math.sqrt(node.degree) * 1.6)

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * ratio))
      canvas.height = Math.max(1, Math.floor(rect.height * ratio))
      draw()
    }

    const step = (): void => {
      const sim = simRef.current
      const { nodes: list, links } = sim
      const alpha = sim.alpha
      // Repulsion is cut off past CUTOFF, so a grid of that cell size only needs the 3×3 neighbouring cells.
      const grid = new Map<string, number[]>()
      list.forEach((node, i) => {
        const key = `${Math.floor(node.x / CUTOFF)},${Math.floor(node.y / CUTOFF)}`
        const cell = grid.get(key)
        if (cell) {
          cell.push(i)
        } else {
          grid.set(key, [i])
        }
      })
      for (let i = 0; i < list.length; i += 1) {
        const a = list[i]
        const cx = Math.floor(a.x / CUTOFF)
        const cy = Math.floor(a.y / CUTOFF)
        for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
          for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
            for (const j of grid.get(`${gx},${gy}`) ?? []) {
              // Each pair once, as in the plain double loop.
              if (j <= i) {
                continue
              }
              const b = list[j]
              let dx = a.x - b.x
              let dy = a.y - b.y
              let distance = dx * dx + dy * dy
              if (distance < 0.01) {
                dx = Math.random() - 0.5
                dy = Math.random() - 0.5
                distance = 0.25
              }
              if (distance > CUTOFF * CUTOFF) {
                continue
              }
              const force = (400 * alpha) / distance
              a.vx += dx * force
              a.vy += dy * force
              b.vx -= dx * force
              b.vy -= dy * force
            }
          }
        }
      }
      for (const [a, b] of links) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.sqrt(dx * dx + dy * dy) || 1
        // As in d3-force: weaken springs on hubs and move the lighter end more, or a note with hundreds of links makes the layout blow up.
        const force = (((distance - 60) / distance) * alpha) / Math.min(a.degree, b.degree)
        const bias = a.degree / (a.degree + b.degree)
        a.vx += dx * force * (1 - bias)
        a.vy += dy * force * (1 - bias)
        b.vx -= dx * force * bias
        b.vy -= dy * force * bias
      }
      for (const node of list) {
        // Gravity keeps unlinked notes from drifting off screen.
        node.vx -= node.x * 0.02 * alpha
        node.vy -= node.y * 0.02 * alpha
        if (!node.fixed) {
          node.x += node.vx
          node.y += node.vy
        }
        node.vx *= 0.6
        node.vy *= 0.6
      }
      sim.alpha = Math.max(0, alpha * 0.985)
    }

    const draw = (): void => {
      const ratio = window.devicePixelRatio || 1
      const { width, height } = canvas
      const { x, y, scale } = view.current
      const sim = simRef.current
      // Only hovering dims the rest; the open note is just highlighted.
      const focus = hover.current
      const neighbors = new Set<SimNode>()
      if (focus) {
        for (const [a, b] of sim.links) {
          if (a === focus) {
            neighbors.add(b)
          } else if (b === focus) {
            neighbors.add(a)
          }
        }
      }
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = colors.background
      context.fillRect(0, 0, width, height)
      if (sim.warming) {
        return
      }
      context.setTransform(ratio * scale, 0, 0, ratio * scale, width / 2 + x * ratio, height / 2 + y * ratio)

      context.lineWidth = 1 / scale
      // One path per style: a stroke per edge is what makes dense vaults slow.
      const edgePaths = [new Path2D(), new Path2D()]
      for (const [a, b] of sim.links) {
        const path = edgePaths[focus && (a === focus || b === focus) ? 1 : 0]
        path.moveTo(a.x, a.y)
        path.lineTo(b.x, b.y)
      }
      context.strokeStyle = colors.edge
      context.globalAlpha = focus ? 0.35 : 1
      context.stroke(edgePaths[0])
      context.strokeStyle = colors.active
      context.globalAlpha = 1
      context.stroke(edgePaths[1])
      const showLabels = scale > 0.7
      context.font = `${11 / scale}px ${cssVar('--app-font-family', 'sans-serif')}`
      context.textAlign = 'center'
      context.textBaseline = 'top'
      // World-space bounds of the canvas; nodes outside are skipped.
      const halfW = width / ratio / 2 / scale
      const halfH = height / ratio / 2 / scale
      const left = -x / scale - halfW - 50
      const right = -x / scale + halfW + 50
      const top = -y / scale - halfH - 50
      const bottom = -y / scale + halfH + 50
      for (const node of sim.nodes) {
        if (node.x < left || node.x > right || node.y < top || node.y > bottom) {
          continue
        }
        const isActive = node.id === activeRef.current
        const lit = !focus || node === focus || neighbors.has(node)
        context.globalAlpha = lit ? 1 : 0.25
        context.fillStyle = isActive || node === hover.current ? colors.active : colors.nodes[node.group % colors.nodes.length]
        const r = radius(node)
        context.beginPath()
        context.arc(node.x, node.y, r, 0, Math.PI * 2)
        context.fill()
        if (showLabels || node === focus || neighbors.has(node)) {
          context.fillStyle = colors.text
          context.globalAlpha = lit ? 0.9 : 0.2
          context.fillText(node.label, node.x, node.y + r + 3 / scale)
        }
      }
      context.globalAlpha = 1
    }

    const tick = (): void => {
      const sim = simRef.current
      if (sim.warming) {
        // Settle the layout in ~12 ms slices before showing it, so a large vault never blocks the UI.
        const until = performance.now() + 12
        do {
          step()
        } while (sim.alpha > 0.01 && performance.now() < until)
        sim.warming = sim.alpha > 0.01
        setProgress(sim.warming ? Math.round((Math.log(sim.alpha) / Math.log(0.01)) * 100) : null)
        frame = requestAnimationFrame(tick)
        return
      }
      if (sim.alpha > 0.01) {
        step()
        draw()
        frame = requestAnimationFrame(tick)
      } else {
        running = false
        draw()
      }
    }
    const start = (): void => {
      if (!running) {
        running = true
        frame = requestAnimationFrame(tick)
      } else {
        draw()
      }
    }
    wake.current = start

    const toWorld = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      const { x, y, scale } = view.current
      return { x: (event.clientX - rect.left - rect.width / 2 - x) / scale, y: (event.clientY - rect.top - rect.height / 2 - y) / scale }
    }
    const hit = (event: { clientX: number; clientY: number }): SimNode | null => {
      const point = toWorld(event)
      let best: SimNode | null = null
      let bestDistance = Infinity
      for (const node of simRef.current.nodes) {
        const distance = Math.hypot(node.x - point.x, node.y - point.y)
        if (distance < radius(node) + 4 / view.current.scale && distance < bestDistance) {
          best = node
          bestDistance = distance
        }
      }
      return best
    }

    let drag: { node: SimNode | null; startX: number; startY: number; moved: boolean; viewX: number; viewY: number } | null = null
    const onDown = (event: PointerEvent): void => {
      canvas.setPointerCapture(event.pointerId)
      const node = hit(event)
      if (node) {
        node.fixed = true
      }
      drag = { node, startX: event.clientX, startY: event.clientY, moved: false, viewX: view.current.x, viewY: view.current.y }
    }
    const onMove = (event: PointerEvent): void => {
      if (!drag) {
        const node = hit(event)
        if (node !== hover.current) {
          hover.current = node
          canvas.style.cursor = node ? 'pointer' : 'grab'
          draw()
        }
        return
      }
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) {
        drag.moved = true
      }
      if (drag.node) {
        const point = toWorld(event)
        drag.node.x = point.x
        drag.node.y = point.y
        simRef.current.alpha = Math.max(simRef.current.alpha, 0.3)
        start()
      } else {
        view.current.x = drag.viewX + event.clientX - drag.startX
        view.current.y = drag.viewY + event.clientY - drag.startY
        draw()
      }
    }
    const onUp = (event: PointerEvent): void => {
      if (drag?.node) {
        drag.node.fixed = false
        if (!drag.moved) {
          onOpenRef.current(drag.node.id)
        }
      }
      drag = null
      canvas.releasePointerCapture(event.pointerId)
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      const next = Math.min(4, Math.max(0.15, view.current.scale * factor))
      const cx = event.clientX - rect.left - rect.width / 2
      const cy = event.clientY - rect.top - rect.height / 2
      // Zoom around the cursor.
      view.current.x = cx - ((cx - view.current.x) * next) / view.current.scale
      view.current.y = cy - ((cy - view.current.y) * next) / view.current.scale
      view.current.scale = next
      draw()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    resize()
    start()
    return () => {
      cancelAnimationFrame(frame)
      wake.current = () => undefined
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [visible, isDark, skin])

  useEffect(() => {
    wake.current()
  }, [activeId])

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" style={{ cursor: 'grab' }} />
      {progress !== null ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background text-xs text-muted-foreground">
          <span>Laying out {nodes.length} notes…</span>
          <div className="h-1 w-48 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
