import { useEffect, useRef, type ReactNode } from 'react'
import { useIsDark } from '@/lib/theme'

export type GraphNode = { id: string; label: string }
export type GraphEdge = { source: string; target: string }

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number; degree: number; fixed: boolean }

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Obsidian-style graph view: a small force simulation on a canvas. Repulsion
 * is O(n²), which stays smooth for a few thousand notes once it settles.
 */
export function NotesGraph({
  nodes,
  edges,
  activeId,
  visible,
  onOpen
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  activeId: string | null
  visible: boolean
  onOpen: (id: string) => void
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const simRef = useRef<{ nodes: SimNode[]; byId: Map<string, SimNode>; links: Array<[SimNode, SimNode]>; alpha: number }>({
    nodes: [],
    byId: new Map(),
    links: [],
    alpha: 1
  })
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
    simRef.current = { nodes: [...byId.values()], byId, links, alpha: previous.size ? 0.5 : 1 }
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
      node: cssVar('--muted-foreground', '#888'),
      text: cssVar('--foreground', '#000'),
      edge: cssVar('--border', '#ddd'),
      active: '#8b5cf6',
      background: cssVar('--background', '#fff')
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
      for (let i = 0; i < list.length; i += 1) {
        const a = list[i]
        for (let j = i + 1; j < list.length; j += 1) {
          const b = list[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let distance = dx * dx + dy * dy
          if (distance < 0.01) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            distance = 0.25
          }
          if (distance > 250_000) {
            continue
          }
          const force = (400 * alpha) / distance
          a.vx += dx * force
          a.vy += dy * force
          b.vx -= dx * force
          b.vy -= dy * force
        }
      }
      for (const [a, b] of links) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.sqrt(dx * dx + dy * dy) || 1
        const force = ((distance - 60) / distance) * 0.06 * alpha
        a.vx += dx * force
        a.vy += dy * force
        b.vx -= dx * force
        b.vy -= dy * force
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
      context.setTransform(ratio * scale, 0, 0, ratio * scale, width / 2 + x * ratio, height / 2 + y * ratio)

      context.lineWidth = 1 / scale
      for (const [a, b] of sim.links) {
        const lit = focus && (a === focus || b === focus)
        context.strokeStyle = lit ? colors.active : colors.edge
        context.globalAlpha = focus && !lit ? 0.35 : 1
        context.beginPath()
        context.moveTo(a.x, a.y)
        context.lineTo(b.x, b.y)
        context.stroke()
      }
      const showLabels = scale > 0.7
      context.font = `${11 / scale}px ${cssVar('--app-font-family', 'sans-serif')}`
      context.textAlign = 'center'
      context.textBaseline = 'top'
      for (const node of sim.nodes) {
        const isActive = node.id === activeRef.current
        const lit = !focus || node === focus || neighbors.has(node)
        context.globalAlpha = lit ? 1 : 0.25
        context.fillStyle = isActive || node === hover.current ? colors.active : colors.node
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
      if (simRef.current.alpha > 0.01) {
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
  }, [visible, isDark])

  useEffect(() => {
    wake.current()
  }, [activeId])

  return <canvas ref={canvasRef} className="h-full w-full" style={{ cursor: 'grab' }} />
}
