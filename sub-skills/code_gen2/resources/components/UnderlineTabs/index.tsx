import React, { useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface TabItem {
  id: string
  label: string
}

interface UnderlineTabsProps {
  tabs: TabItem[]
  activeId: string
  onChange: (id: string) => void
  /**
   * 字体尺寸变体
   * - 'default'：画布外/页面级场景，选中 16px（font-headline-s）
   * - 'sm'：卡片内部有标题的场景，选中 14px（font-headline-xs）
   */
  size?: 'default' | 'sm'
  /** 用于父级 flex row 的 className/style 扩展 */
  className?: string
}

/**
 * UnderlineTabs - 下划线 Tab 组件
 *
 * size 变体：
 * - 'default'（默认）：画布外/页面级场景，选中 16px（font-headline-s）
 * - 'sm'：卡片内部有标题的场景，选中 14px（font-headline-xs）
 *
 * 样式规范（两种 size 共用）：
 * - 选中态：品牌色字 + 底部 2px 胶囊下划线
 * - 未选中态：40% 黑色字
 * - 按钮与下划线间距：8px
 * - 文字不换行，超出宽度时横向滚动
 *
 * 布局：
 * - Tab 区域自适应可用空间，右侧操作按钮固定不滚动
 *
 * 适用场景：Tab 切换逻辑（非筛选），如页面级 Tab、子 Tab 等
 */
const UnderlineTabs: React.FC<UnderlineTabsProps> = ({
  tabs,
  activeId,
  onChange,
  size = 'default',
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)

  /* ── 选中 tab 变化时自动滚动 ──
   *
   * 策略（双层）：
   * 1. 活性 tab 在中间（左右都有邻居）→ 优先让 prev+active+next 三连完全可见
   *    如果放不下 → 居中活性 tab（双侧露出半截），用户也能感知两边还有
   * 2. 活性 tab 在边缘 → 沿用原逻辑，只保证自身完整可见
   */
  useEffect(() => {
    if (!scrollRef.current) return
    const container = scrollRef.current
    const activeBtn = container.querySelector(`[data-tab-id="${activeId}"]`) as HTMLElement | null
    if (!activeBtn) return

    const prevBtn = activeBtn.previousElementSibling as HTMLElement | null
    const nextBtn = activeBtn.nextElementSibling as HTMLElement | null

    /* ── 中间 tab：双邻居提示 ── */
    if (prevBtn && nextBtn) {
      const cRect = container.getBoundingClientRect()
      const aRect = activeBtn.getBoundingClientRect()
      const pRect = prevBtn.getBoundingClientRect()
      const nRect = nextBtn.getBoundingClientRect()

      const totalWidth = nRect.right - pRect.left   // 三连总宽
      const gap = 4                                 // 左边缘呼吸间距

      if (totalWidth <= cRect.width - gap) {
        // 能放下 → 左对齐 prevBtn
        container.scrollTo({
          left: container.scrollLeft + pRect.left - cRect.left - gap,
          behavior: 'smooth',
        })
      } else {
        // 放不下 → 居中活性 tab（双侧自然露出半截）
        container.scrollTo({
          left: container.scrollLeft + aRect.left - cRect.left - (cRect.width - aRect.width) / 2,
          behavior: 'smooth',
        })
      }
      return
    }

    /* ── 边缘 tab：原逻辑，只保证自身完整可见 ── */
    const cRect = container.getBoundingClientRect()
    const bRect = activeBtn.getBoundingClientRect()
    if (bRect.right > cRect.right - 12) {
      container.scrollBy({ left: bRect.right - cRect.right + 12, behavior: 'smooth' })
    } else if (bRect.left < cRect.left + 4) {
      container.scrollBy({ left: bRect.left - cRect.left - 4, behavior: 'smooth' })
    }
  }, [activeId])

  return (
    <div
      ref={scrollRef}
      className={cn('flex gap-4 overflow-x-auto', className)}
      style={{
        minWidth: 0,
        flex: '1 1 0%',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
        {tabs.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative flex-shrink-0 bg-transparent border-none cursor-pointer transition-colors',
                isActive
                  ? size === 'sm' ? 'font-headline-xs' : 'font-headline-s'
                  : size === 'sm' ? 'font-body-m' : 'font-body-l'
              )}
              style={{
                padding: 'var(--spacing-xs) 0 var(--spacing-md)',
                whiteSpace: 'nowrap',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
              {/* 选中态下划线 — 胶囊形，两端全圆 */}
              <div
                className="absolute rounded-[var(--radius-full)] transition-all"
                style={{
                  height: 2,
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
                }}
              />
            </button>
          )
        })}
    </div>
  )
}

export default UnderlineTabs
