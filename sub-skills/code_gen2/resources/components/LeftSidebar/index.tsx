import React from 'react'
import { cn } from '@/lib/utils'

interface FilterItem {
  id: string
  name: string
}

interface LeftSidebarProps {
  filters: FilterItem[]
  activeId: string
  onChange: (id: string) => void
}

/**
 * LeftSidebar - 左侧纵向筛选栏
 *
 * 每个按钮 72×46px 透明容器
 * 选中态：左侧 1px 品牌色线条指示器 + 品牌色 medium 文字
 * 未选中态：无线条，medium 文字（60% 透明度）
 * 文本统一 12px / 16px 行高，距离左侧 12px
 */
const LeftSidebar: React.FC<LeftSidebarProps> = ({ filters, activeId, onChange }) => {
  return (
    <div className="w-[72px] flex-shrink-0 overflow-y-auto">
      {filters.map((filter) => {
        const active = activeId === filter.id
        return (
          <button
            key={filter.id}
            onClick={() => onChange(filter.id)}
            className={cn(
              'w-[72px] h-[46px] flex items-center transition-colors duration-150 relative',
              'active:bg-[var(--color-primary-active)]'
            )}
          >
            {/* 左侧线条指示器（绝对定位，不影响文字位置） */}
            {active && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[1px] h-[16px]" style={{ backgroundColor: 'var(--color-primary)' }} />
            )}
            {/* 文本 */}
            <span
              className="font-headline-xxs pl-[var(--spacing-lg)]"
              style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
            >
              {filter.name.length > 4 ? filter.name.slice(0, 3) + '...' : filter.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default LeftSidebar
