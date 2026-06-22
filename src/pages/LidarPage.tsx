import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMqtt, MqttStatus } from '../hooks/useMqtt'

interface Point { X: number; Y: number }
interface DetectedObject {
  id: number; X: number; Y: number
  width: number; distance: number; pointCount: number
}
interface ExcludeRegion { xMin: number; xMax: number; yMin: number; yMax: number }
interface DeviceConfig {
  name: string
  angleMin: number; angleMax: number
  regionXMin: number; regionXMax: number
  regionYMin: number; regionYMax: number
  excludeRegions: ExcludeRegion[]
  mirrorX: boolean
  rotationDeg: number
  topicRaw: string; topicObjects: string
}

const CONFIG_TOPIC = 'Urg/Config/#'
const STATUS_TOPIC = 'Urg/Status'
const DEFAULT_BROKER = 'ws://192.168.1.154:9001'
const LS_BROKER = 'urg_broker'

function loadBroker() { return localStorage.getItem(LS_BROKER) ?? DEFAULT_BROKER }

const GRID_COLOR   = '#1e293b'
const AXIS_COLOR   = '#334155'
const POINT_COLOR  = '#22d3ee'
const ORIGIN_COLOR = '#f97316'
const OBJ_COLOR    = '#f43f5e'
const OBJ_LABEL    = '#fbbf24'

function drawScene(
  canvas: HTMLCanvasElement,
  points: Point[],
  objects: DetectedObject[],
  scale: number,
  config?: DeviceConfig,
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  const cx = W / 2
  const cy = H / 2

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W, H)

  const gridStep = scale
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  for (let x = cx % gridStep; x < W; x += gridStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = cy % gridStep; y < H; y += gridStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  for (let r = gridStep; r < Math.max(W, H); r += gridStep) {
    ctx.strokeStyle = GRID_COLOR
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#475569'
    ctx.font = '11px monospace'
    ctx.fillText(`${(r / scale).toFixed(0)}m`, cx + r + 3, cy - 3)
  }

  ctx.strokeStyle = AXIS_COLOR
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke()

  if (config) {
    const diag = Math.sqrt(W * W + H * H)
    const rotRad     = config.rotationDeg * Math.PI / 180
    const mirrorSign = config.mirrorX ? -1 : 1

    const toCanvasDir = (deg: number) => {
      const a = deg * Math.PI / 180
      const rx = mirrorSign * Math.sin(a)
      const ry = Math.cos(a)
      const px = rx * Math.cos(rotRad) - ry * Math.sin(rotRad)
      const py = rx * Math.sin(rotRad) + ry * Math.cos(rotRad)
      return { dx: px, dy: -py }
    }

    ctx.save()
    ctx.strokeStyle = 'rgba(148,163,184,0.3)'
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])
    for (const deg of [config.angleMin, config.angleMax]) {
      const { dx, dy } = toCanvasDir(deg)
      ctx.beginPath(); ctx.moveTo(cx, cy)
      ctx.lineTo(cx + dx * diag, cy + dy * diag); ctx.stroke()
    }
    ctx.fillStyle = 'rgba(148,163,184,0.05)'
    ctx.beginPath(); ctx.moveTo(cx, cy)
    const steps = 60
    for (let i = 0; i <= steps; i++) {
      const deg = config.angleMin + (config.angleMax - config.angleMin) * i / steps
      const { dx, dy } = toCanvasDir(deg)
      ctx.lineTo(cx + dx * diag, cy + dy * diag)
    }
    ctx.closePath(); ctx.fill()
    ctx.setLineDash([]); ctx.restore()

    const BIG = 900
    const bounded =
      config.regionXMin > -BIG || config.regionXMax < BIG ||
      config.regionYMin > -BIG || config.regionYMax < BIG
    if (bounded) {
      const rx1 = cx + config.regionXMin * scale
      const rx2 = cx + config.regionXMax * scale
      const ry1 = cy - config.regionYMax * scale
      const ry2 = cy - config.regionYMin * scale
      ctx.save()
      ctx.strokeStyle = 'rgba(251,191,36,0.4)'; ctx.lineWidth = 1.5
      ctx.setLineDash([8, 4])
      ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1)
      ctx.fillStyle = 'rgba(251,191,36,0.04)'
      ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1)
      ctx.setLineDash([]); ctx.restore()
    }

    if (config.excludeRegions?.length) {
      ctx.save()
      ctx.strokeStyle = 'rgba(239,68,68,0.6)'; ctx.lineWidth = 1.5
      ctx.setLineDash([6, 3]); ctx.fillStyle = 'rgba(239,68,68,0.08)'
      for (const r of config.excludeRegions) {
        const ex1 = cx + r.xMin * scale; const ex2 = cx + r.xMax * scale
        const ey1 = cy - r.yMax * scale; const ey2 = cy - r.yMin * scale
        ctx.fillRect(ex1, ey1, ex2 - ex1, ey2 - ey1)
        ctx.strokeRect(ex1, ey1, ex2 - ex1, ey2 - ey1)
      }
      ctx.setLineDash([]); ctx.restore()
    }
  }

  if (points.length > 0) {
    ctx.fillStyle = POINT_COLOR
    for (const p of points) {
      ctx.beginPath(); ctx.arc(cx + p.X * scale, cy - p.Y * scale, 3, 0, Math.PI * 2); ctx.fill()
    }
  }

  for (const obj of objects) {
    const ox = cx + obj.X * scale
    const oy = cy - obj.Y * scale
    const r  = Math.max(8, (obj.width / 2) * scale)
    ctx.strokeStyle = OBJ_COLOR; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = OBJ_COLOR
    ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = OBJ_LABEL; ctx.font = 'bold 12px monospace'
    ctx.fillText(`#${obj.id}`, ox + r + 4, oy - 4)
    ctx.font = '11px monospace'; ctx.fillStyle = '#94a3b8'
    ctx.fillText(`${obj.distance.toFixed(2)}m`, ox + r + 4, oy + 10)
    ctx.fillText(`w:${obj.width.toFixed(2)}m`, ox + r + 4, oy + 23)
  }

  ctx.strokeStyle = ORIGIN_COLOR; ctx.lineWidth = 2
  const ro = 6
  ctx.beginPath(); ctx.moveTo(cx - ro, cy); ctx.lineTo(cx + ro, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - ro); ctx.lineTo(cx, cy + ro); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, ro, 0, Math.PI * 2); ctx.stroke()
}

const STATUS_STYLE: Record<MqttStatus, string> = {
  disconnected: 'bg-slate-700 text-slate-300',
  connecting:   'bg-yellow-600 text-yellow-100',
  connected:    'bg-emerald-600 text-emerald-100',
  error:        'bg-red-600 text-red-100',
}
const STATUS_LABEL: Record<MqttStatus, string> = {
  disconnected: '已斷線',
  connecting:   '連線中…',
  connected:    '已連線',
  error:        '錯誤',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LidarPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)
  const scaleRef  = useRef(200)

  const pointsMapRef  = useRef<Map<string, Point[]>>(new Map())
  const objectsMapRef = useRef<Map<string, DetectedObject[]>>(new Map())

  const [brokerUrl, setBrokerUrl] = useState(loadBroker)
  const [inputUrl, setInputUrl]   = useState(loadBroker)
  const [connected, setConnected] = useState(false)

  const [deviceConfigs, setDeviceConfigs] = useState<Record<string, DeviceConfig>>({})
  const [activeDeviceName, setActiveDeviceName] = useState('')
  const [showRaw, setShowRaw] = useState(true)
  const [simMode, setSimMode] = useState(false)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)

  // Refs for RAF loop (avoids stale closures)
  const deviceConfigsRef    = useRef<Record<string, DeviceConfig>>({})
  const activeDeviceNameRef = useRef('')
  const showRawRef          = useRef(true)

  // Simulation refs
  const simIdRef       = useRef(1)
  const simActiveRef   = useRef(false)
  const simThrottleRef = useRef(0)

  const allTopics = useMemo(() => {
    const extra = Object.values(deviceConfigs).flatMap(c => [c.topicRaw, c.topicObjects])
    return [CONFIG_TOPIC, STATUS_TOPIC, ...extra]
  }, [deviceConfigs])

  const [pointCounts, setPointCounts] = useState<Record<string, number>>({})
  const [scale, setScale]             = useState(scaleRef.current)
  const [totalObjs, setTotalObjs]     = useState(0)

  // Sync refs
  useEffect(() => { deviceConfigsRef.current = deviceConfigs }, [deviceConfigs])
  useEffect(() => { activeDeviceNameRef.current = activeDeviceName }, [activeDeviceName])
  useEffect(() => { showRawRef.current = showRaw }, [showRaw])

  useEffect(() => { localStorage.setItem(LS_BROKER, brokerUrl) }, [brokerUrl])

  // Auto-select first device when configs arrive
  useEffect(() => {
    if (!activeDeviceName) {
      const first = Object.keys(deviceConfigs)[0]
      if (first) setActiveDeviceName(first)
    }
  }, [deviceConfigs, activeDeviceName])

  const handleMessage = useCallback((topic: string, payload: string) => {
    try {
      if (topic === STATUS_TOPIC) {
        setBackendOnline(payload.trim() === 'online')
        return
      }

      const data = JSON.parse(payload)

      if (topic.startsWith('Urg/Config/') && data && typeof data === 'object' && !Array.isArray(data) && 'topicRaw' in data) {
        const cfg = data as DeviceConfig
        setDeviceConfigs(prev => ({ ...prev, [cfg.name]: cfg }))
        return
      }

      if (!Array.isArray(data)) return
      const isObjectsTopic = Object.values(deviceConfigsRef.current).some(c => c.topicObjects === topic)
      if (isObjectsTopic && (data.length === 0 || ('X' in data[0] && 'id' in data[0]))) {
        const objs = data as DetectedObject[]
        objectsMapRef.current.set(topic, objs)
        setPointCounts(prev => ({ ...prev, [topic]: objs.length }))
        setTotalObjs([...objectsMapRef.current.values()].reduce((s, a) => s + a.length, 0))
      } else if (!isObjectsTopic) {
        const pts = data as Point[]
        pointsMapRef.current.set(topic, pts)
        setPointCounts(prev => ({ ...prev, [topic]: pts.length }))
      }
    } catch { /* ignore */ }
  }, [])

  const { status, errorMsg, publish } = useMqtt({
    brokerUrl, topic: allTopics, onMessage: handleMessage, enabled: connected,
  })

  // RAF loop — reads only from refs, no deps needed
  useEffect(() => {
    const loop = () => {
      if (canvasRef.current) {
        const cfg    = deviceConfigsRef.current[activeDeviceNameRef.current]
        const points = showRawRef.current && cfg
          ? (pointsMapRef.current.get(cfg.topicRaw) ?? [])
          : []
        const objs = cfg ? (objectsMapRef.current.get(cfg.topicObjects) ?? []) : []
        drawScene(canvasRef.current, points, objs, scaleRef.current, cfg)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Shared zoom helper (wheel / pinch / buttons all funnel through here)
  const zoomBy = useCallback((factor: number) => {
    scaleRef.current = Math.min(2000, Math.max(10, scaleRef.current * factor))
    setScale(scaleRef.current)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.1 : 0.9)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // Pinch-to-zoom for touch devices (phones / tablets)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    let lastDist = 0
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { lastDist = dist(e.touches); e.preventDefault() }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      e.preventDefault()
      const d = dist(e.touches)
      if (lastDist > 0) zoomBy(d / lastDist)
      lastDist = d
    }
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) lastDist = 0 }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onTouchEnd)
    canvas.addEventListener('touchcancel', onTouchEnd)
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [zoomBy])

  // Simulation mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return

    const toMeters = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = (e.clientX - rect.left) * (canvas.width  / rect.width)
      const my = (e.clientY - rect.top)  * (canvas.height / rect.height)
      const X = (mx - canvas.width  / 2) / scaleRef.current
      const Y = (canvas.height / 2 - my) / scaleRef.current
      return { X, Y }
    }

    const sendObj = (e: MouseEvent) => {
      const cfg = deviceConfigsRef.current[activeDeviceNameRef.current]
      if (!cfg) return
      const { X, Y } = toMeters(e)
      const distance = parseFloat(Math.sqrt(X * X + Y * Y).toFixed(3))
      publish(cfg.topicObjects, JSON.stringify([{ id: simIdRef.current++, X, Y, width: 0.3, distance, pointCount: 5 }]))
    }

    const clearObj = () => {
      const cfg = deviceConfigsRef.current[activeDeviceNameRef.current]
      if (cfg) publish(cfg.topicObjects, '[]')
      simActiveRef.current = false
    }

    const onMouseDown = (e: MouseEvent) => {
      if (!simMode) return
      simActiveRef.current = true
      sendObj(e)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!simMode || !simActiveRef.current) return
      const now = Date.now()
      if (now - simThrottleRef.current < 50) return
      simThrottleRef.current = now
      sendObj(e)
    }

    const onMouseUp    = () => { if (simMode && simActiveRef.current) clearObj() }
    const onMouseLeave = () => { if (simMode && simActiveRef.current) clearObj() }

    canvas.addEventListener('mousedown',  onMouseDown)
    canvas.addEventListener('mousemove',  onMouseMove)
    canvas.addEventListener('mouseup',    onMouseUp)
    canvas.addEventListener('mouseleave', onMouseLeave)
    return () => {
      canvas.removeEventListener('mousedown',  onMouseDown)
      canvas.removeEventListener('mousemove',  onMouseMove)
      canvas.removeEventListener('mouseup',    onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [simMode, publish])

  const handleConnect    = () => { setBrokerUrl(inputUrl); setConnected(true) }
  const handleDisconnect = () => {
    setConnected(false)
    pointsMapRef.current.clear()
    objectsMapRef.current.clear()
    setPointCounts({})
    setTotalObjs(0)
    setDeviceConfigs({})
    setActiveDeviceName('')
    setBackendOnline(null)
  }

  const activeConfig = deviceConfigs[activeDeviceName]

  return (
    <div className="flex flex-col h-dvh bg-slate-900 text-slate-100">

      {/* ── Top toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
        <span className="font-semibold text-sm text-slate-300">URG LiDAR</span>

        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>
          {STATUS_LABEL[status]}
        </span>

        <input
          className="flex-1 min-w-[200px] bg-slate-700 border border-slate-600 rounded px-3 py-1.5
                     text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          disabled={connected}
          placeholder="ws://host:9001"
        />

        {!connected ? (
          <button onClick={handleConnect}
            className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-sm font-medium transition-colors">
            連線
          </button>
        ) : (
          <button onClick={handleDisconnect}
            className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-sm font-medium transition-colors">
            斷線
          </button>
        )}

        {connected && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-rose-900 text-rose-300 font-mono">
            偵測物件: {totalObjs}
          </span>
        )}

        {connected && backendOnline !== null && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            backendOnline
              ? 'bg-emerald-900 text-emerald-300'
              : 'bg-red-900 text-red-300'
          }`}>
            後台 {backendOnline ? '上線' : '離線'}
          </span>
        )}

        {errorMsg && (
          <span className="text-xs text-red-400 font-mono truncate max-w-xs" title={errorMsg}>
            ⚠ {errorMsg}
          </span>
        )}

        <span className="ml-auto text-xs text-slate-500">
          縮放 <span className="text-slate-300">{scale.toFixed(0)} px/m</span>
          <span className="ml-1">(滾輪／雙指／按鈕)</span>
        </span>
      </div>

      {/* ── Device tabs + scan toggle ── */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 border-b border-slate-700 overflow-x-auto shrink-0">

        {Object.values(deviceConfigs).map(cfg => {
          const isActive  = activeDeviceName === cfg.name
          const objCount  = pointCounts[cfg.topicObjects]
          return (
            <div key={cfg.name} onClick={() => setActiveDeviceName(cfg.name)}
              className={`group flex items-center gap-1.5 px-3 py-1 rounded cursor-pointer text-sm select-none transition-colors ${
                isActive ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              <span className="font-medium">{cfg.name}</span>
              {typeof objCount === 'number' && (
                <span className={`text-xs px-1.5 rounded-full ${
                  isActive ? 'bg-cyan-600 text-cyan-100' : 'bg-slate-600 text-slate-300'
                }`}>
                  {objCount}
                </span>
              )}
            </div>
          )
        })}

        {connected && Object.keys(deviceConfigs).length === 0 && (
          <span className="text-xs text-slate-500 italic">等待裝置設定...</span>
        )}

        <div className="w-px h-5 bg-slate-600 mx-2 shrink-0" />

        {/* 掃描顯示切換 */}
        <button
          onClick={() => setShowRaw(v => !v)}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            showRaw
              ? 'bg-cyan-800 text-cyan-200 hover:bg-cyan-700'
              : 'bg-slate-700 text-slate-500 hover:bg-slate-600 hover:text-slate-300'
          }`}
          title="顯示/隱藏原始掃描點">
          掃描
        </button>

        {/* 模擬模式切換 */}
        {connected && (
          <button
            onClick={() => setSimMode(v => !v)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              simMode
                ? 'bg-amber-600 text-amber-100 hover:bg-amber-500'
                : 'bg-slate-700 text-slate-500 hover:bg-slate-600 hover:text-slate-300'
            }`}
            title="模擬偵測物件（按住滑鼠拖曳）">
            模擬
          </button>
        )}
      </div>

      {/* ── Active device config info ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1 bg-slate-900 border-b border-slate-800 shrink-0 text-xs font-mono">
        {activeConfig ? (<>
          <span className="text-cyan-500 shrink-0">{activeConfig.name}</span>
          <span className="text-slate-600">角度</span>
          <span className="text-slate-300">{activeConfig.angleMin}°～{activeConfig.angleMax}°</span>
          {(activeConfig.regionXMin > -900 || activeConfig.regionXMax < 900 ||
            activeConfig.regionYMin > -900 || activeConfig.regionYMax < 900) && <>
            <span className="text-slate-600">區域</span>
            <span className="text-amber-400">
              X[{activeConfig.regionXMin}~{activeConfig.regionXMax}]
              {' '}Y[{activeConfig.regionYMin}~{activeConfig.regionYMax}] m
            </span>
          </>}
          {activeConfig.mirrorX && <>
            <span className="text-slate-600">鏡射</span>
            <span className="text-violet-400">X</span>
          </>}
          {activeConfig.rotationDeg !== 0 && <>
            <span className="text-slate-600">旋轉</span>
            <span className="text-violet-400">{activeConfig.rotationDeg}°</span>
          </>}
        </>) : (
          <span className="text-slate-600">—</span>
        )}
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ touchAction: 'none' }}
          className={`w-full h-full block ${simMode ? 'cursor-crosshair' : ''}`}
        />

        {/* 縮放按鈕（觸控裝置 / 精準縮放） */}
        <div
          className="absolute bottom-3 right-3 flex flex-col gap-1.5 select-none"
          style={{
            bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
            right:  'calc(0.75rem + env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => zoomBy(1.2)}
            className="w-10 h-10 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-200
                       text-2xl leading-none flex items-center justify-center"
            title="放大" aria-label="放大">
            +
          </button>
          <button
            onClick={() => zoomBy(1 / 1.2)}
            className="w-10 h-10 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-200
                       text-2xl leading-none flex items-center justify-center"
            title="縮小" aria-label="縮小">
            −
          </button>
        </div>
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-500 text-sm">輸入 Broker 位址後按「連線」</p>
          </div>
        )}
        {connected && (
          <div className="absolute top-3 right-3 bg-slate-800/80 rounded px-3 py-2 text-xs space-y-1">
            {showRaw && (
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-cyan-400 inline-block"/>
                <span className="text-slate-300">原始掃描點</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-rose-500 inline-block"/>
              <span className="text-slate-300">偵測物件</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div
        className="px-4 py-1 bg-slate-800 border-t border-slate-700 text-xs text-slate-500 shrink-0"
        style={{ paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom))' }}
      >
        Broker 需啟用 WebSocket（Mosquitto: <span className="font-mono">listener 9001 / protocol websockets</span>）
      </div>
    </div>
  )
}
