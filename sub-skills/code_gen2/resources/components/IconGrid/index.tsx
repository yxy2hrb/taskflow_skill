import React from 'react'
import SectionTitle from '@/components/SectionTitle'

export interface IconGridItem {
  icon: React.ElementType
  label: string
  color: string
}

interface IconGridProps {
  /** 列数 (3 或 4) */
  cols: number
  /** 图标项 */
  items: IconGridItem[]
  /** 可选标题（仅 card 变体显示） */
  title?: string
  /** plain = 纯网格 / card = 白色卡片包裹 */
  variant?: 'plain' | 'card'
  /** 空格子提示文案 */
  emptyText?: string
}

/**
 * IconGrid — 通用图标阵列
 *
 * 规范（2026-05-07 定稿）：
 * - 图标底托：40×40，--radius-md
 * - 内部图标：24×24
 * - 文字：.font-body-s + --color-text-primary
 * - 底托↔文字间距：--spacing-md
 */
const IconGrid: React.FC<IconGridProps> = ({
  cols,
  items,
  title,
  variant = 'plain',
  emptyText = '暂无数据',
}) => {
  const grid = items.length === 0 ? (
    <div className="flex items-center justify-center" style={{ padding: 32 }}>
      <span className="font-body-s" style={{ color: 'var(--color-text-hint)' }}>
        {emptyText}
      </span>
    </div>
  ) : (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 'var(--spacing-xl)',
      }}
    >
      {items.map((entry) => {
        const IconComponent = entry.icon
        return (
          <button
            key={entry.label}
            className="flex flex-col items-center bg-transparent border-none cursor-pointer"
            style={{ gap: 'var(--spacing-md)' }}
          >
            <div
              className="rounded-[var(--radius-md)] flex items-center justify-center"
              style={{ width: 40, height: 40, backgroundColor: `${entry.color}15` }}
            >
              <IconComponent size={24} style={{ color: entry.color }} />
            </div>
            <span className="font-body-s truncate w-full text-center" style={{ color: 'var(--color-text-primary)' }}>
              {entry.label}
            </span>
          </button>
        )
      })}
    </div>
  )

  if (variant === 'card') {
    return (
      <div className="bg-white rounded-[var(--radius-lg)] flex flex-col" style={{ padding: 'var(--spacing-lg)', gap: 'var(--spacing-lg)' }}>
        {title && <SectionTitle variant="card" title={title} />}
        {grid}
      </div>
    )
  }

  return grid
}

export default IconGrid
