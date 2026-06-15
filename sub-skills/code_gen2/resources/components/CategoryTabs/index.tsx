import React, { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface Category {
  id: string
  name: string
  image?: string
}

interface CategoryTabsProps {
  categories: Category[]
  activeId: string
  onChange: (id: string) => void
}

/**
 * CategoryTabs - 分类页签（产品图片横滑选择）
 *
 * 每个产品项 64×66px：
 *   上方 48×48 白色圆角矩形（12px 圆角），内含 40×40 图片容器
 *   下方 产品名 10px 文字
 *
 * 选中态：文字 #000 medium + 白色矩形 1px 内描边
 * 未选中：文字 #666 regular
 */
const CategoryTabs: React.FC<CategoryTabsProps> = ({
  categories,
  activeId,
  onChange,
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
  }, [categories])

  const isActive = (id: string) => activeId === id

  return (
    <div className="relative border-b" style={{ height: 92, flexShrink: 0 }}>
      {/* 左渐变遮罩 */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[var(--color-bg-page)] to-transparent z-10 pointer-events-none" />
      )}
      {/* 右渐变遮罩 */}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--color-bg-page)] to-transparent z-10 pointer-events-none" />
      )}

      <div
        ref={scrollRef}
        className="flex items-start h-full overflow-x-auto"
        style={{
          padding: '10px var(--spacing-md) var(--spacing-xl)',
          gap: 'var(--spacing-xs)',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            className={cn(
              'flex-shrink-0 flex flex-col items-center active:scale-95 transition-transform duration-150',
              'w-[64px]'
            )}
          >
            {/* 白色圆角矩形容器 48×48，圆角 12px */}
            <div
              className={cn(
                'w-12 h-12 rounded-[var(--radius-md)] flex items-center justify-center',
                'bg-white',
                isActive(cat.id) && 'border border-black'
              )}
            >
              {/* 40×40 图片容器（透明底设备图片） */}
              <div className="w-10 h-10 flex items-center justify-center">
                {cat.image ? (
                  <img
                    src={cat.image}
                    alt={cat.name}
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-body-l" style={{ color: 'var(--color-text-disabled)' }}>
                    ?
                  </div>
                )}
              </div>
            </div>
            {/* 产品名 */}
            <span
              className="mt-2 font-caption-s text-center whitespace-nowrap w-full truncate"
              style={{
                color: isActive(cat.id) ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              {cat.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default CategoryTabs
