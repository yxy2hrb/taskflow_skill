import React from 'react'

// ==================== 类型 ====================

export interface StatCardItem {
  label: string
  value: string
  unit: string
  color: string
}

interface StatCardGridProps {
  items: StatCardItem[]
  /** 列数，默认 2 */
  columns?: number
}

// ==================== 统计卡片网格 ====================

/**
 * StatCardGrid — 统计数值卡片网格
 *
 * 2×2 布局，每项显示 label/value/unit，
 * value 数字颜色由 color 控制。
 *
 * ┌─────────────┐  ┌─────────────┐
 * │ 进行中活动   │  │  本月线索    │
 * │ 6      个   │  │ 128    条   │
 * └─────────────┘  └─────────────┘
 * ┌─────────────┐  ┌─────────────┐
 * │ 线索转化率   │  │  曝光量     │
 * │ 23.5    %   │  │ 36.2   万  │
 * └─────────────┘  └─────────────┘
 */
const StatCardGrid: React.FC<StatCardGridProps> = ({ items, columns = 2 }) => {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 'var(--spacing-md)',
      }}
    >
      {items.map((card) => (
        <div
          key={card.label}
          className="bg-white rounded-[var(--radius-lg)] flex flex-col"
          style={{ padding: 'var(--spacing-lg)' }}
        >
          <span className="font-body-s" style={{ color: 'var(--color-text-muted)' }}>
            {card.label}
          </span>
          <div className="flex items-baseline" style={{ gap: 2, marginTop: 'var(--spacing-xs)' }}>
            <span className="font-headline-xxl" style={{ color: card.color }}>
              {card.value}
            </span>
            <span className="font-caption-m" style={{ color: 'var(--color-text-muted)' }}>
              {card.unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default StatCardGrid
