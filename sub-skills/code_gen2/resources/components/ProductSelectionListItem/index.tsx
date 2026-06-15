import React, { useState, useEffect } from 'react'
import { ArrowRightLeft, MoreHorizontal, Check } from 'lucide-react'

// ==================== 类型 ====================

export interface QuotationItem {
  id: string
  name: string
  status: '谈单中' | '已成单' | '未成单'
  scene?: string
  time: string
}

interface ProductSelectionListItemProps {
  item: QuotationItem
  onForward?: (id: string) => void
  onMore?: (id: string) => void
  /** 修改配单状态回调 */
  onStatusChange?: (id: string, status: QuotationItem['status']) => void
  /** 是否为列表最后一项。最后一项不渲染分割线，以业务内容结尾 */
  isLast?: boolean
}

// ==================== 华为 Logo ====================

const HuaweiLogo: React.FC<{ size?: number }> = ({ size = 42 }) => (
  <div
    className="flex-shrink-0 flex items-center justify-center"
    style={{
      width: size,
      height: size,
      backgroundColor: 'var(--color-primary)',
      borderRadius: 'var(--radius-md)',
    }}
  >
    <span
      className="font-headline-xs"
      style={{
        color: 'var(--color-text-white)',
        lineHeight: 1,
        fontSize: size * 0.42,
      }}
    >
      H
    </span>
  </div>
)

// ==================== 状态颜色 ====================

const statusColor: Record<QuotationItem['status'], string> = {
  '谈单中': 'var(--color-warning)',
  '已成单': 'var(--color-success)',
  '未成单': 'var(--color-text-muted)',
}

const statusBg: Record<QuotationItem['status'], string> = {
  '谈单中': 'rgba(249, 115, 22, 0.1)',
  '已成单': 'rgba(16, 185, 129, 0.1)',
  '未成单': 'rgba(156, 163, 175, 0.1)',
}

// ==================== 工具函数 ====================

/** 将日期字符串格式化为 "YYYY-MM-DD  HH:mm:ss"（日期后两个空格） */
const formatTime = (dateStr: string): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr

  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  return `${y}-${m}-${day}  ${hh}:${mm}:${ss}`
}

// ==================== 状态菜单配置 ====================

const STATUS_MENU_OPTIONS: { id: QuotationItem['status']; label: string }[] = [
  { id: '谈单中', label: '谈单中' },
  { id: '已成单', label: '已成单' },
  { id: '未成单', label: '未成单' },
]

// ==================== 操作按钮公共样式 ====================

const actionBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  padding: 0,
}

// ==================== 配单列表项 ====================

/**
 * 配单列表项
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  [Icon]    [Title text                 🔄  ⋮]       │
 * │  42×42     [Tag               Time]                 │ ← 菜单
 * │                                                     │  ← 12px
 * ├─────────────────────────────────────────────────────┤  ← 分割线 1px
 *
 * - 点击 ⋮ 弹出状态菜单（选谈单中/已成单/未成单）
 * - 选中项右侧显示 ✓
 */
const ProductSelectionListItem: React.FC<ProductSelectionListItemProps> = ({
  item,
  onForward,
  onMore,
  onStatusChange,
  isLast,
}) => {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const handleDocClick = () => setMenuOpen(false)
    // 延迟一帧，避免当前点击立即触发
    const timer = setTimeout(() => {
      document.addEventListener('click', handleDocClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleDocClick)
    }
  }, [menuOpen])

  const handleOpenMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    setMenuOpen(true)
    onMore?.(item.id)
  }

  const handleSelectStatus = (status: QuotationItem['status']) => {
    onStatusChange?.(item.id, status)
    setMenuOpen(false)
  }

  return (
    <div>
      {/* ── 主行（relative 仅由按钮内部菜单使用） ── */}
      <div
        className="flex active:scale-[0.99] transition-transform duration-150 cursor-pointer"
        style={{ height: 46, alignItems: 'flex-start' }}
      >
        {/* 左侧：Icon（42×42，圆角 8，距顶 4px） */}
        <div className="flex-shrink-0" style={{ marginTop: 'var(--spacing-xs)', marginRight: 'var(--spacing-lg)' }}>
          <HuaweiLogo size={42} />
        </div>

        {/* 中间：详情区（flex-1 自适应，撑满 46px） */}
        <div
          className="flex flex-col justify-between"
          style={{ flex: 1, minWidth: 0, height: 46 }}
        >
          {/* 第一行：标题 + 操作按钮 */}
          <div className="flex items-center justify-between">
            <span
              className="font-headline-xs truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {item.name}
            </span>

            {/* 操作按钮组 */}
            <div className="flex-shrink-0 flex" style={{ gap: 'var(--spacing-md)', marginLeft: 'auto' }}>
              <button
                style={actionBtnStyle}
                onClick={(e) => { e.stopPropagation(); onForward?.(item.id) }}
              >
                <ArrowRightLeft size={14} />
              </button>

              {/* 更多按钮 + 状态菜单（relative 锚点仅包裹按钮，不影响行高） */}
              <div className="relative">
                <button
                  style={actionBtnStyle}
                  onClick={handleOpenMenu}
                >
                  <MoreHorizontal size={14} />
                </button>

                {/* ── 状态菜单弹窗 ── */}
                {menuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()} // 阻止点击菜单面板冒泡到 document
                    style={{
                      position: 'absolute',
                      zIndex: 50,
                      width: 144,
                      height: 152,
                      borderRadius: 'var(--radius-2xl)',
                      backgroundColor: 'var(--color-bg-card)',
                      boxShadow: 'var(--shadow-lg)',
                      right: 0,
                      top: '100%',
                      marginTop: 'var(--spacing-sm)',
                      padding: 'var(--spacing-xl)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    {STATUS_MENU_OPTIONS.map((opt, i) => (
                      <React.Fragment key={opt.id}>
                        <button
                          className="flex items-center justify-between bg-transparent border-none cursor-pointer w-full hover:bg-[var(--color-bg-hover)]"
                          style={{
                            padding: 'var(--spacing-xs) var(--spacing-md)',
                            borderRadius: 'var(--radius-xxs)',
                            transition: 'background-color 150ms ease',
                          }}
                          onClick={(e) => { e.stopPropagation(); handleSelectStatus(opt.id) }}
                        >
                          <span
                            className="font-body-l"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {opt.label}
                          </span>
                          {item.status === opt.id && (
                            <Check size={14} style={{ color: 'var(--color-text-primary)' }} />
                          )}
                        </button>
                        {i < STATUS_MENU_OPTIONS.length - 1 && (
                          <hr className="divider" style={{ margin: 0 }} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 第二行：状态标签（左下）+ 时间（右下） */}
          <div className="flex items-end justify-between">
            <span
              className="font-caption-s rounded-[var(--radius-full)] flex-shrink-0"
              style={{
                color: statusColor[item.status],
                backgroundColor: statusBg[item.status],
                padding: '1px 8px',
              }}
            >
              {item.status}
            </span>
            <span
              className="font-caption-s truncate"
              style={{ color: 'var(--color-text-muted)', marginLeft: 'auto' }}
            >
              {formatTime(item.time)}
            </span>
          </div>
        </div>
      </div>

      {/* ── 间距 + 分割线（最后一项不渲染） ── */}
      {!isLast && (
        <>
          <div style={{ height: 'var(--spacing-lg)' }} />
          <div
            style={{
              height: 1,
              backgroundColor: 'var(--color-bg-disabled)',
              marginLeft: 54, // 42(icon) + 12(gap)
            }}
          />
        </>
      )}
    </div>
  )
}

export default ProductSelectionListItem
