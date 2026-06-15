import React from 'react'

// ==================== 类型 ====================

export interface QuickEntryItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number }>
  label: string
  color: string
}

interface QuickEntryGridProps {
  items: QuickEntryItem[]
  title?: string
}

// ==================== 快捷入口网格 ====================

/**
 * QuickEntryGrid — 快捷入口 3 列网格
 *
 * 白色卡片包裹，每项显示图标（48px 圆形容器）+ 标签文字。
 * 支持可选标题。
 *
 * ┌──────────────────────────────┐
 * │  快捷入口                     │
 * │ ┌────┐ ┌────┐ ┌────┐        │
 * │ │ 🎯 │ │ 📊 │ │ 👥 │        │
 * │ │活动│ │看板│ │客户│        │
 * │ └────┘ └────┘ └────┘        │
 * │ ... 共 6 项，3 列           │
 * └──────────────────────────────┘
 */
const QuickEntryGrid: React.FC<QuickEntryGridProps> = ({ items, title }) => {
  return (
    <div className="bg-white rounded-[var(--radius-lg)] flex flex-col" style={{ padding: 'var(--spacing-lg)', gap: 'var(--spacing-lg)' }}>
      {title && (
        <span className="font-headline-xs" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </span>
      )}
      <div className="grid grid-cols-3" style={{ gap: 'var(--spacing-lg)' }}>
        {items.map((entry) => {
          const IconComponent = entry.icon
          return (
            <button
              key={entry.label}
              className="flex flex-col items-center bg-transparent border-none cursor-pointer"
              style={{ gap: 'var(--spacing-sm)' }}
            >
              <div
                className="rounded-[var(--radius-xl)] flex items-center justify-center size-icon-entry"
                style={{ backgroundColor: `${entry.color}15` }}
              >
                <IconComponent size={24} style={{ color: entry.color }} />
              </div>
              <span className="font-caption-m" style={{ color: 'var(--color-text-secondary)' }}>
                {entry.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default QuickEntryGrid
