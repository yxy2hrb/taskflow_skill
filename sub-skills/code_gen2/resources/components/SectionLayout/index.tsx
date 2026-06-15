import React from 'react'
import UnderlineTabs from '@/components/UnderlineTabs'
import SectionTitle from '@/components/SectionTitle'

interface TabItem {
  id: string
  label: string
}

interface SectionLayoutProps {
  /**
   * browse  — 查看类瀑布流：透明背景，标题+页签+内容直接写在页面底色上
   * card    — 操作类卡片式：白色卡片容器，圆角+padding 包裹模块
   */
  variant: 'browse' | 'card'
  /** 楼层标题 */
  title: string
  /** "更多"按钮文案，默认 "更多" */
  moreText?: string
  /** "更多"按钮点击回调 */
  onMore?: () => void
  /** 可选页签数据 */
  tabs?: TabItem[]
  /** 当前选中页签 ID */
  activeTab?: string
  /** 页签切换回调 */
  onTabChange?: (id: string) => void
  /** 标题行右侧自定义内容（替换默认的"更多"按钮） */
  headerRightAction?: React.ReactNode
  /** 内容区域 */
  children: React.ReactNode
}

/**
 * SectionLayout — 楼层容器组件
 *
 * 两种变异：
 * - `browse`：查看类场景（新闻资讯、直播、课程等）。标题+页签+内容直落，
 *   无白色卡片容器包裹。内容区的每个子项需自带视觉样式。
 * - `card`：操作类场景（商城、工作台、工具、我的等）。白色卡片容器包裹整个
 *   模块，形成与页面底色的视觉区隔。
 *
 * 规则说明：
 * ```
 * 查看类（browse → 瀑布流）        操作类（card → 卡片式）
 * ┌──────────────────────┐        ┌──────────────────────┐
 * │ 标题         更多 >   │        │ ╔═ 标题     更多 > ═╗ │
 * │ [Tab1] [Tab2]         │        │ ║ [Tab1] [Tab2]    ║ │
 * │ ┌─内容─────────────┐ │        │ ║ ┌─内容─────────┐ ║ │
 * │ │ 内容项1           │ │        │ ║ │ 内容项1       │ ║ │
 * │ │ 内容项2           │ │        │ ║ │ 内容项2       │ ║ │
 * │ └───────────────────┘ │        │ ║ └───────────────┘ ║ │
 * └──────────────────────┘        │ ╚═══════════════════╝ │
 *                                  └──────────────────────┘
 * ```
 */
const SectionLayout: React.FC<SectionLayoutProps> = ({
  variant,
  title,
  moreText = '更多',
  onMore,
  tabs,
  activeTab,
  onTabChange,
  headerRightAction,
  children,
}) => {
  /** 页签行 */
  const renderTabs = (size: 'default' | 'sm' = 'default') => {
    if (!tabs || !activeTab || !onTabChange) return null
    return (
      <UnderlineTabs
        tabs={tabs}
        activeId={activeTab}
        onChange={onTabChange}
        size={size}
      />
    )
  }

  /* ── browse 变体：透明背景，标题+页签+内容直落 ── */
  if (variant === 'browse') {
    return (
      <div className="flex flex-col" style={{ gap: 'var(--spacing-lg)' }}>
        <SectionTitle
          variant="browse"
          title={title}
          onMore={onMore}
          moreText={moreText}
          headerRightAction={headerRightAction}
        />
        {renderTabs('default')}
        {children}
      </div>
    )
  }

  /* ── card 变体：白色卡片容器 ── */
  return (
    <div
      className="bg-white rounded-[var(--radius-lg)] flex flex-col"
      style={{ padding: 'var(--spacing-lg)', gap: 'var(--spacing-lg)' }}
    >
      <SectionTitle
        variant="card"
        title={title}
        onMore={onMore}
        moreText={moreText}
        headerRightAction={headerRightAction}
      />
      {renderTabs('sm')}
      {children}
    </div>
  )
}

export default SectionLayout
