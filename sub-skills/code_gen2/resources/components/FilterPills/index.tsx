import React, { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface FilterItem {
  id: string
  name: string
}

interface FilterPillsProps {
  filters: FilterItem[]
  activeId: string
  onChange: (id: string) => void
  /** 是否显示左右淡出遮罩 */
  fadeEdges?: boolean
}

/**
 * FilterPills - 胶囊筛选组件
 *
 * 统一 light 样式：
 * - 选中态：5% 品牌色底 + 品牌色文字
 * - 未选中态：5% 黑色底 + 纯黑文字
 * - 高度 28px
 *
 * 所有胶囊筛选场景共用此样式，保证视觉一致性
 */
const FilterPills: React.FC<FilterPillsProps> = ({
  filters,
  activeId,
  onChange,
  fadeEdges = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = () => {
    const el = scrollRef.current
    if (el) {
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
    }
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    el?.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)
    return () => {
      el?.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [filters])

  return (
    <div className={cn('relative flex-shrink-0', fadeEdges && 'border-b')}>
      {/* 左淡出遮罩 */}
      {fadeEdges && canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[var(--color-bg-page)] to-transparent z-10 pointer-events-none" />
      )}
      {/* 右淡出遮罩 */}
      {fadeEdges && canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--color-bg-page)] to-transparent z-10 pointer-events-none" />
      )}

      <div
        ref={scrollRef}
        className="flex items-center gap-2 py-2 overflow-x-auto"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {filters.map((filter) => {
          const isActive = activeId === filter.id
          return (
            <button
              key={filter.id}
              onClick={() => onChange(filter.id)}
              className="flex-shrink-0 px-3 flex items-center active:scale-95 transition-all duration-150"
              style={{
                backgroundColor: isActive ? 'var(--color-primary-soft)' : 'var(--color-bg-disabled)',
                color: isActive ? 'var(--color-primary)' : undefined,
                height: 28,
                borderRadius: 'var(--radius-full)',
              }}
            >
              <span className="whitespace-nowrap font-body-s">
                {filter.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default FilterPills
