import React from 'react'

/* ─────────── 类型 ─────────── */

export interface HotVideoCardProps {
  /** 卡片标题 */
  title: string
  /** 辅助说明（livestream 布局时显示在标题下方） */
  subtitle?: string
  /** 封面图渐变色 */
  imageGradient: string
  /** 图片高度，默认 90 */
  imageHeight?: number
  /** 卡片宽度，默认 160 */
  width?: number | string
  /** 标签文本（默认布局时显示左下角） */
  tag?: string
  /** 右侧操作插槽（传此 prop 时切换到 livestream 布局） */
  action?: React.ReactNode
  /** 分享回调（默认布局时显示分享图标） */
  onShare?: () => void
  /** 卡片点击 */
  onClick?: () => void
}

/* ─────────── 组件 ─────────── */

/** 判断 imageGradient 是图片 URL 还是 CSS 渐变 */
function resolveBackground(val: string): string {
  if (!val) return '#E5E7EB'
  if (val.startsWith('data:') || val.startsWith('http://') || val.startsWith('https://')) {
    return `url(${val}) center / cover`
  }
  return val
}

/**
 * HotVideoCard — 上图下文视频卡片
 *
 * 两种布局模式：
 * - default：标题(多行省略) + 标签+分享，用于 160×170 热门视频
 * - livestream（传 action）：左文字 + 右操作，用于 328×184 大卡片
 *
 * 圆角：--radius-lg（16px）
 */
const HotVideoCard: React.FC<HotVideoCardProps> = ({
  title,
  subtitle,
  imageGradient,
  imageHeight = 90,
  width = 160,
  tag,
  action,
  onShare,
  onClick,
}) => {
  return (
    <button
      className="rounded-[var(--radius-lg)] bg-white overflow-hidden border-none cursor-pointer text-left flex flex-col flex-shrink-0"
      style={{ width }}
      onClick={onClick}
    >
      {/* ── 封面图区 ── */}
      <div className="relative" style={{ height: imageHeight, background: resolveBackground(imageGradient) }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" opacity={0.7}>
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1.5" />
            <path d="M10 8v8l6-4-6-4z" fill="white" />
          </svg>
        </div>
      </div>

      {/* ── 内容区 ── */}
      <div className="flex flex-col" style={{ padding: 'var(--spacing-lg)', flex: 1 }}>
        {action ? (
          /* ── livestream 布局：左文字 + 右操作 ── */
          <div className="flex items-center" style={{ gap: 'var(--spacing-md)', flex: 1 }}>
            <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
              <p
                className="font-headline-xs truncate"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {title}
              </p>
              {subtitle && (
                <p
                  className="font-body-s truncate"
                  style={{ color: 'var(--color-text-muted)', marginTop: 'var(--spacing-xs)' }}
                >
                  {subtitle}
                </p>
              )}
            </div>
            {action}
          </div>
        ) : (
          /* ── default 布局：标题(多行省略) + 标签+分享 ── */
          <>
            <p
              className="font-headline-xxs"
              style={{
                color: 'var(--color-text-primary)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                flex: 1,
                marginBottom: 'var(--spacing-xs)',
              }}
            >
              {title}
            </p>
            <div className="flex-distribute">
              {tag && (
                <span
                  className="font-caption-s inline-flex rounded-[var(--radius-xxs)]"
                  style={{
                    padding: '1px 6px',
                    color: 'var(--color-primary)',
                    backgroundColor: 'var(--color-primary-soft)',
                  }}
                >
                  {tag}
                </span>
              )}
              {onShare && (
                <button
                  className="bg-transparent border-none cursor-pointer flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); onShare() }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-hint)' }}>
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </button>
  )
}

export default HotVideoCard
