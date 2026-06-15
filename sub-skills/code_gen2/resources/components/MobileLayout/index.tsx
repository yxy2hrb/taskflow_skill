import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import BottomNav from '@/components/BottomNav'
import LiveStreamPage from '@/pages/secondary/live-stream'
import SolutionCasePage from '@/pages/secondary/solution-case'
import StatusBar from '@/components/StatusBar'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useSolutionStore } from '@/store/solutionStore'

interface MobileLayoutProps {
  children: React.ReactNode
}

/** 画板固定尺寸 */
const BOARD_W = 360
const BOARD_H = 792

const OVERLAY_ANIM_MS = 300

const MobileLayout: React.FC<MobileLayoutProps> = ({ children }) => {
  const location = useLocation()

  /* ── 多个覆盖层（二级页面）统一管理 ── */
  const liveStreamIsOpen = useLiveStreamStore((s) => s.isOpen)
  const solutionIsOpen = useSolutionStore((s) => s.isOpen)
  const solutionName = useSolutionStore((s) => s.currentSolution)

  const isAnyOverlayOpen = liveStreamIsOpen || solutionIsOpen

  const [overlayVisible, setOverlayVisible] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [overlayKey, setOverlayKey] = useState(0)

  useEffect(() => {
    if (isAnyOverlayOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsExiting(false)
      setOverlayKey((k) => k + 1)
      setOverlayVisible(true)
    }
  }, [isAnyOverlayOpen])

  const handleCloseOverlay = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => {
      setOverlayVisible(false)
      setIsExiting(false)
      // 关闭所有已打开的覆盖层 store
      useLiveStreamStore.getState().close()
      useSolutionStore.getState().close()
    }, OVERLAY_ANIM_MS)
  }, [])

  // 遮罩透明度：退出中 → 0，可见 → 1，不可见 → 0
  const maskOpacity = isExiting ? 0 : overlayVisible ? 1 : 0

  /* ── 根据路由选择背景渐变层 ── */
  const canvasClassName = useMemo(() => {
    const base = 'rounded-[var(--radius-4xl)] flex flex-col overflow-hidden mobile-canvas'
    switch (location.pathname) {
      case '/':
        return `${base} bg-gradient-layer-1`   /* 首页背景 */
      case '/tools':
        return `${base} bg-gradient-layer-2`   /* 工具页背景 */
      case '/projects':
        return `${base} bg-gradient-layer-3`   /* 工作台背景 */
      case '/profile':
        return `${base} bg-gradient-layer-3`   /* 我的页面 — 复用工作台背景样式 */
      default:
        return base
    }
  }, [location.pathname])

  const canvasStyle: React.CSSProperties = {
    width: BOARD_W,
    height: BOARD_H,
    position: 'relative',
  }
  // 非渐变页用纯色背景
  if (!canvasClassName.includes('bg-gradient-layer')) {
    canvasStyle.backgroundColor = 'var(--color-bg-page)'
  }

  /* ── admin 预览模式：只渲染纯页面内容，不要手机壳 ── */
  if (new URLSearchParams(location.search).get('admin_preview') === '1') {
    return <>{children}</>
  }

  /* ── hidenav 模式：渲染完整页面但不显示 BottomNav ── */
  const hideNav = new URLSearchParams(location.search).get('hidenav') === '1'

  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: '#eeeeee',
        overflow: 'hidden',
      }}
    >
      <div
        className={canvasClassName}
        style={canvasStyle}
      >
        {/* 模拟系统状态栏 */}
        <StatusBar />

        {/* 页面内容 — 始终渲染，不受覆盖层影响 */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* route key 变化时触发 fade-in 动画，避免页面切换闪屏 */}
          <div key={location.pathname} className="flex-1 flex flex-col overflow-hidden animate-page-in">
            {children}
          </div>
        </main>

        {/* 底部导航（hidenav 模式下隐藏） */}
        {!hideNav && <BottomNav />}

        {/* 浮层 Portal 容器 — pointer-events: none 不拦截下层点击，子元素可覆盖为 auto */}
        <div id="drawer-root" style={{ position: 'absolute', inset: 0, zIndex: 90, pointerEvents: 'none' }} />

        {/* 二级页面覆盖层 — 始终在 DOM 中，用 visibility 控制显隐 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            visibility: overlayVisible ? 'visible' : 'hidden',
            pointerEvents: overlayVisible ? 'auto' : 'none',
          }}
        >
          {/* 黑色半透明遮罩 — opacity transition 实现平滑淡入淡出 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'var(--color-mask)',
              opacity: maskOpacity,
              transition: `opacity ${OVERLAY_ANIM_MS}ms ease-out`,
            }}
          />
          {/* 滑入面板 — 无背景色，子页面自带背景 */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 1,
            }}
          >
            {/* 根据哪个 store 激活，渲染对应的二级页面 */}
            {liveStreamIsOpen && (
              <LiveStreamPage key={overlayKey} onClose={handleCloseOverlay} />
            )}
            {solutionIsOpen && solutionName && (
              <SolutionCasePage key={overlayKey} solutionName={solutionName} onClose={handleCloseOverlay} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default MobileLayout
