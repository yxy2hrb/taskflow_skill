import React from 'react'
import MoreButton from '@/components/MoreButton'

interface SectionTitleProps {
  /** 楼层上下文（用于区分右侧操作区样式：browse/简易模式、card/MoreButton模式） */
  variant: 'browse' | 'card'
  /** 标题文字 */
  title: string
  /** "更多"按钮回调（传此属性时渲染内置 MoreButton） */
  onMore?: () => void
  /** 自定义"更多"按钮文案 */
  moreText?: string
  /** 标题行右侧自定义内容（优先级高于 onMore） */
  headerRightAction?: React.ReactNode
}

/** SectionTitle — 楼层标题行
 *
 * 纯标题 + 右侧操作区，不自带外边距（由父容器控制）。
 * 标题统一使用 font-headline-s（16px medium），不受 variant 影响。
 * variant 仅控制右侧操作区（内置 MoreButton 或自定义 headerRightAction）。
 */
const SectionTitle: React.FC<SectionTitleProps> = ({
  variant: _variant,
  title,
  onMore,
  moreText,
  headerRightAction,
}) => {
  void _variant
  return (
    <div className="flex items-center justify-between">
      <span
        className="font-headline-s"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {title}
      </span>
      {headerRightAction ? (
        <div className="flex items-center">{headerRightAction}</div>
      ) : onMore ? (
        <MoreButton onClick={onMore} text={moreText} />
      ) : null}
    </div>
  )
}

export default SectionTitle
