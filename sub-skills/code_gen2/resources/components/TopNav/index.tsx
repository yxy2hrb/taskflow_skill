import React, { useState } from 'react'
import { Search, ShoppingCart, User, QrCode, Bell, Settings, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ─────────── 类型定义 ─────────── */

export type TopNavVariant = 'tabs' | 'title' | 'drawer'

interface TopNavProps {
  /** 导航变体：tabs=文本页签, title=纯标题, drawer=抽屉菜单 */
  variant?: TopNavVariant
  /** 传入则显示返回箭头（二级页面），不传则不显示（一级页面） */
  onBack?: () => void
  /** variant="tabs" 时：当前选中 tab 值 */
  activeTab?: string
  /** variant="tabs" 时：页签列表 */
  tabs?: string[]
  /** variant="tabs" 时：tab 切换回调 */
  onTabChange?: (tab: string) => void
  /** variant="title" 时：标题文字 */
  title?: string
  /** variant="drawer" 时：当前选中项 */
  drawerValue?: string
  /** variant="drawer" 时：抽屉选项列表 */
  drawerOptions?: string[]
  /** variant="drawer" 时：抽屉选项切换回调 */
  onDrawerChange?: (value: string) => void
  /** variant="drawer" 时：是否默认展开抽屉菜单（预览用） */
  drawerDefaultOpen?: boolean
  /** 右侧操作按钮（可选组合，最多3个） */
  actions: ('search' | 'cart' | 'profile' | 'scan' | 'message' | 'settings' | 'grid')[]
  /** 购物车数量角标 */
  cartCount?: number
  onSearch?: () => void
  onCart?: () => void
  onProfile?: () => void
  onScan?: () => void
  onMessage?: () => void
  onSettings?: () => void
  onGrid?: () => void
}

/* ─────────── 返回按钮 ─────────── */

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="flex items-center justify-center bg-transparent border-none cursor-pointer flex-shrink-0"
      style={{ width: 24, height: 40, color: 'var(--color-text-primary)' }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ marginLeft: -4 }}>
        <path
          d="M15 19L8 12L15 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/* ─────────── 左侧渲染 ─────────── */

function LeftTabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: string[]
  activeTab: string
  onTabChange: (tab: string) => void
}) {
  return (
    <div className="flex items-center" style={{ gap: 'var(--spacing-xl)' }}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab
        return (
          <button
            key={tab}
            className={cn(
              'transition-colors duration-150 cursor-pointer bg-transparent border-none p-0',
              isActive ? 'font-headline-xxl' : 'font-headline-m'
            )}
            style={{ color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        )
      })}
    </div>
  )
}

function LeftTitle({ title }: { title: string }) {
  return (
    <div
      className="font-headline-xxl truncate"
      style={{ color: 'var(--color-text-primary)' }}
    >
      {title}
    </div>
  )
}

function LeftDrawer({
  value,
  options,
  onChange,
  defaultOpen = false,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="relative">
      <button
        className="flex items-center bg-transparent border-none cursor-pointer p-0"
        style={{ gap: 'var(--spacing-md)', color: 'var(--color-text-primary)' }}
        onClick={() => setOpen(!open)}
      >
        <span className="font-headline-xxl">
          {value}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={cn('transition-transform duration-200', open && 'rotate-180')}
        >
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* 抽屉下拉面板 */}
      {open && (
        <>
          {/* 遮罩层 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* 下拉列表 */}
          <div
            className="absolute top-full left-0 mt-2 bg-white rounded-[var(--radius-2xl)] z-50 overflow-hidden"
            style={{ minWidth: 120 }}
          >
            {options.map((opt) => (
              <button
                key={opt}
                className={cn(
                  'w-full text-left px-4 py-2.5 bg-transparent border-none cursor-pointer transition-colors',
opt === value ? 'font-headline-xs' : 'font-body-m',
                )}
                style={{ color: opt === value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
                onClick={() => {
                  onChange(opt)
                  setOpen(false)
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ─────────── 右侧操作按钮 ─────────── */

function RightActions({
  actions,
  cartCount,
  onSearch,
  onCart,
  onProfile,
  onScan,
  onMessage,
  onSettings,
  onGrid,
}: {
  actions: ('search' | 'cart' | 'profile' | 'scan' | 'message' | 'settings' | 'grid')[]
  cartCount?: number
  onSearch?: () => void
  onCart?: () => void
  onProfile?: () => void
  onScan?: () => void
  onMessage?: () => void
  onSettings?: () => void
  onGrid?: () => void
}) {
  /** 图标映射：action name → lucide icon */
  const iconMap: Record<string, React.ReactNode> = {
    search: <Search size={24} />,
    cart: (
      <>
        <ShoppingCart size={24} />
        {(cartCount ?? 0) > 0 && (
          <span
className="absolute -top-0.5 -right-0.5 text-white rounded-[var(--radius-full)] flex items-center justify-center font-caption-s"
            style={{ width: 16, height: 16, backgroundColor: 'var(--color-primary)' }}
          >
            {cartCount}
          </span>
        )}
      </>
    ),
    profile: <User size={24} />,
    scan: <QrCode size={24} />,
    message: <Bell size={24} />,
    settings: <Settings size={24} />,
    grid: <LayoutGrid size={24} />,
  }

  const callbacks: Record<string, (() => void) | undefined> = {
    search: onSearch,
    cart: onCart,
    profile: onProfile,
    scan: onScan,
    message: onMessage,
    settings: onSettings,
    grid: onGrid,
  }

  return (
    <div className="flex items-center" style={{ gap: 5 }}>
      {actions.slice(0, 3).map((action) => (
        <button
          key={action}
          onClick={callbacks[action]}
          className="flex items-center justify-center bg-transparent border-none cursor-pointer relative"
          style={{ width: 40, height: 40, color: 'var(--color-text-primary)' }}
        >
          {iconMap[action]}
        </button>
      ))}
    </div>
  )
}

/* ─────────── 主组件 ─────────── */

/**
 * TopNav - 顶部导航栏
 * 高度: 56px，左右内边距: 16px
 *
 * 一级页面:
 *   variant="tabs":   左侧文本页签（选中 Bold 24px / 未选中 Medium 18px）
 *   variant="title":  左侧纯标题（Bold 24px，font-headline-xxl）
 *   variant="drawer": 左侧标题 + 12px 三角图标 → 点击展开下拉抽屉
 *
 * 二级页面:
 *   传 onBack 后左侧多一个返回箭头（24px 线性图标，40px 隐形容器）
 *   后面接 title 或 drawer
 *
 * 右侧: actions 控制显示哪些图标，默认不显示
 */
const TopNav: React.FC<TopNavProps> = ({
  variant = 'tabs',
  onBack,
  activeTab = '',
  tabs = [],
  onTabChange,
  title = '',
  drawerValue = '',
  drawerOptions = [],
  onDrawerChange,
  drawerDefaultOpen = false,
  actions = [],
  cartCount = 0,
  onSearch,
  onCart,
  onProfile,
  onScan,
  onMessage,
  onSettings,
  onGrid,
}) => {
  // 左侧内容
  const leftContent = (() => {
    if (variant === 'tabs') {
      return <LeftTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange!} />
    }
    if (variant === 'title') {
      return <LeftTitle title={title} />
    }
    if (variant === 'drawer') {
      return (
        <LeftDrawer
          value={drawerValue}
          options={drawerOptions}
          onChange={onDrawerChange!}
          defaultOpen={drawerDefaultOpen}
        />
      )
    }
    return null
  })()

  return (
    <div
      className="flex items-center justify-between flex-shrink-0"
      style={{ height: 56, padding: `0 var(--spacing-xl)` }}
    >
      {/* 左侧：返回箭头(可选) + 内容 */}
      <div className="flex items-center min-w-0" style={{ gap: 'var(--spacing-lg)' }}>
        {onBack && <BackButton onBack={onBack} />}
        <div className="min-w-0">{leftContent}</div>
      </div>

      {/* 右侧 */}
      <RightActions
        actions={actions}
        cartCount={cartCount}
        onSearch={onSearch}
        onCart={onCart}
        onProfile={onProfile}
        onScan={onScan}
        onMessage={onMessage}
        onSettings={onSettings}
        onGrid={onGrid}
      />
    </div>
  )
}

export default TopNav
