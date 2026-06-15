import React from 'react'
import { QrCode } from 'lucide-react'

// ==================== 类型 ====================

export interface EntryCard {
  id: string
  title: string
  subtitle: string
  color: string
  bgColor: string
  iconBg: string
  /** 图标：Lucide 图标名（如 "QrCode"）或图片 URL/data URL */
  icon?: string
}

interface EntryCardProps {
  card: EntryCard
  /** 卡片宽度，默认 158 */
  width?: number
  /** 卡片高度，默认 58 */
  height?: number
}

// ==================== 支持的自定义 Lucide 图标映射 ====================

const KNOWN_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  QrCode,
}

// ==================== 入口卡片 ====================

/** 入口卡片 — 左文右图，tap-scale 反馈 */
const EntryCard: React.FC<EntryCardProps> = ({ card, width = 158, height = 58 }) => {
  /** 渲染右侧图标 */
  const renderIcon = () => {
    const icon = card.icon

    // 图片 URL / data URL → <img>
    if (icon && (icon.startsWith('data:') || icon.startsWith('http'))) {
      return (
        <img
          src={icon}
          alt={card.title}
          style={{ width: 24, height: 24, objectFit: 'contain' }}
        />
      )
    }

    // Lucide 图标名 → 组件渲染
    if (icon && KNOWN_ICONS[icon]) {
      const IconComp = KNOWN_ICONS[icon]
      return <IconComp size={20} color={card.color} />
    }

    // 兜底：硬编码 SVG（按 card.id），或默认 QrCode
    if (card.id === 'product' || card.id === 'scene' || card.id === 'survey') {
      return (
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
          {card.id === 'product' && (
            <>
              <rect x="2" y="6" width="10" height="14" rx="2" stroke={card.color} strokeWidth="1.8" fill={card.bgColor} />
              <rect x="8" y="2" width="10" height="14" rx="2" stroke={card.color} strokeWidth="1.8" fill="white" />
              <circle cx="18.5" cy="18.5" r="3" fill={card.color} />
              <path d="M17.5 18.5h2M18.5 17.5v2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
            </>
          )}
          {card.id === 'scene' && (
            <>
              <circle cx="12" cy="5" r="2.5" stroke={card.color} strokeWidth="1.8" fill={card.bgColor} />
              <path d="M8 9v7a1 1 0 001.8.6L12 18l2.2-1.4A1 1 0 0016 16V9" stroke={card.color} strokeWidth="1.8" strokeLinecap="round" />
              <path d="M6 12h4M14 12h4M6 15h4M14 15h4" stroke={card.color} strokeWidth="1.4" strokeLinecap="round" />
            </>
          )}
          {card.id === 'survey' && (
            <>
              <circle cx="12" cy="12" r="9" stroke={card.color} strokeWidth="1.8" fill={card.bgColor} />
              <path d="M12 3C8.5 3 6 5.5 6 9c0 5 6 12 6 12s6-7 6-12c0-3.5-2.5-6-6-6z" stroke={card.color} strokeWidth="1.5" />
              <circle cx="12" cy="9" r="2" fill={card.color} />
            </>
          )}
        </svg>
      )
    }

    // 全新卡片没有自定义图标 → 默认 QrCode（与硬编码 SVG 占位等大）
    return <QrCode size={28} color={card.color} />
  }

  return (
    <button
      className="flex items-center bg-white rounded-[var(--radius-lg)] active:scale-[0.98] transition-transform duration-150 cursor-pointer border-none"
      style={{
        width,
        height,
        padding: 'var(--spacing-lg)',
      }}
    >
      {/* 左侧内容区：最大 80px，超出省略，文字左对齐 */}
      <div
        className="flex flex-col justify-between flex-shrink-0 overflow-hidden"
        style={{ width: 80, maxWidth: 80, textAlign: 'left' }}
      >
        <p
          className="font-headline-xs truncate"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {card.title}
        </p>
        <p
          className="font-caption-s truncate"
          style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--spacing-xs)' }}
        >
          {card.subtitle}
        </p>
      </div>

      {/* 右侧配图 */}
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: 34, height: 34, marginLeft: 'auto' }}
      >
        {renderIcon()}
      </div>
    </button>
  )
}

export default EntryCard
