import React from 'react'
import { CapsuleButton } from '@/components/ui/Button'

/* ──────────────────────────────
   ButtonBar — 按钮操作栏
   Pixso 设计: 360px 容器，支持 7 种布局变体
   ────────────────────────────── */

export type ButtonBarVariant =
  | 'single-primary'
  | 'single-secondary'
  | 'input-primary'
  | 'input-secondary'
  | 'dual'
  | 'checkbox-dual'
  | 'triple'

export interface ButtonBarProps {
  /** 布局变体 */
  variant: ButtonBarVariant
  /** 主按钮文本 */
  primaryLabel?: string
  /** 次要按钮文本 */
  secondaryLabel?: string
  /** 第三按钮文本（仅 triple 有效） */
  thirdLabel?: string
  /** 输入框占位文本 */
  inputPlaceholder?: string
  /** 复选框标签文本 */
  checkboxLabel?: string
  /** 容器宽度（默认 360；嵌套在弹窗/容器内可传 "100%"） */
  width?: number | string
  /** 自定义 className */
  className?: string
  /** 点击主按钮回调 */
  onPrimaryClick?: () => void
  /** 点击次要按钮回调 */
  onSecondaryClick?: () => void
  /** 点击第三按钮回调（仅 triple 有效） */
  onThirdClick?: () => void
}

/* ─── CheckboxItem — 复选框 + 标签 ─── */
const CheckboxItem: React.FC<{ label?: string }> = ({ label = '选项' }) => {
  const [checked, setChecked] = React.useState(false)
  return (
    <button
      className="flex items-center gap-2 shrink-0 tap-scale"
      style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
      onClick={() => setChecked(!checked)}
    >
      <div
        style={{
          width: 24,
          height: 24,
          position: 'relative',
          borderRadius: checked ? 4 : 4,
          border: checked ? 'none' : '2px solid rgba(0, 0, 0, 0.15)',
          backgroundColor: checked ? 'var(--color-primary)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
        }}
      >
        {checked && (
          <svg
            width="12"
            height="9"
            viewBox="0 0 12 9"
            fill="none"
            style={{ display: 'block' }}
          >
            <path
              d="M1 4.5L4.5 8L11 1"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span
        style={{
          fontSize: 16,
          fontFamily: 'HarmonyOS Sans SC, sans-serif',
          lineHeight: '20px',
          color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  )
}

/* ─── ActionInput — 输入框 ─── */
const ActionInput: React.FC<{
  placeholder?: string
  width?: number
}> = ({ placeholder = '占位文字', width = 196 }) => {
  return (
    <input
      type="text"
      placeholder={placeholder}
      style={{
        width,
        height: 40,
        padding: '10px 12px',
        border: 'none',
        borderRadius: 0,
        backgroundColor: 'rgba(199, 0, 11, 0.05)',
        fontSize: 16,
        fontFamily: 'HarmonyOS Sans SC, sans-serif',
        lineHeight: '20px',
        color: 'var(--color-text-primary)',
        outline: 'none',
        flexShrink: 0,
      }}
    />
  )
}

/* ─── 主组件 ─── */
const ButtonBar: React.FC<ButtonBarProps> = ({
  variant,
  primaryLabel = '强调按钮',
  secondaryLabel = '次要按钮',
  thirdLabel = '次要按钮',
  inputPlaceholder = '占位文字',
  checkboxLabel = '选项',
  width = 360,
  className = '',
  onPrimaryClick,
  onSecondaryClick,
  onThirdClick,
}) => {
  const emptyFn = () => {}
  const fluid = width === '100%'
  const buttonMinWidth = fluid ? 0 : 120

  const renderContent = () => {
    switch (variant) {
      /* ── 1. 单主按钮（撑满容器） ── */
      case 'single-primary':
        return (
          <CapsuleButton size="large" variant="primary" className="w-full" onClick={onPrimaryClick || emptyFn}>
            {primaryLabel}
          </CapsuleButton>
        )

      /* ── 2. 单次要按钮（撑满容器） ── */
      case 'single-secondary':
        return (
          <CapsuleButton size="large" variant="secondary" className="w-full" onClick={onSecondaryClick || emptyFn}>
            {secondaryLabel}
          </CapsuleButton>
        )

      /* ── 3. 输入框 + 主按钮 ── */
      case 'input-primary':
        return (
          <div className="flex w-full items-center" style={{ gap: 'var(--spacing-lg)' }}>
            <ActionInput placeholder={inputPlaceholder} />
            <div className="flex-1" style={{ minWidth: buttonMinWidth }}>
              <CapsuleButton size="large" variant="primary" className="w-full" onClick={onPrimaryClick || emptyFn}>
                {primaryLabel}
              </CapsuleButton>
            </div>
          </div>
        )

      /* ── 4. 输入框 + 次要按钮 ── */
      case 'input-secondary':
        return (
          <div className="flex w-full items-center" style={{ gap: 'var(--spacing-lg)' }}>
            <ActionInput placeholder={inputPlaceholder} />
            <div className="flex-1" style={{ minWidth: buttonMinWidth }}>
              <CapsuleButton size="large" variant="secondary" className="w-full" onClick={onSecondaryClick || emptyFn}>
                {secondaryLabel}
              </CapsuleButton>
            </div>
          </div>
        )

      /* ── 5. 次要 + 主按钮（并列，各占一半） ── */
      case 'dual':
        return (
          <div className="flex w-full" style={{ gap: 'var(--spacing-lg)' }}>
            <div className="flex-1" style={{ minWidth: buttonMinWidth }}>
              <CapsuleButton size="large" variant="secondary" className="w-full" onClick={onSecondaryClick || emptyFn}>
                {secondaryLabel}
              </CapsuleButton>
            </div>
            <div className="flex-1" style={{ minWidth: buttonMinWidth }}>
              <CapsuleButton size="large" variant="primary" className="w-full" onClick={onPrimaryClick || emptyFn}>
                {primaryLabel}
              </CapsuleButton>
            </div>
          </div>
        )

      /* ── 6. 复选框 + 次要 + 主按钮 ── */
      case 'checkbox-dual':
        return (
          <div className="flex w-full items-center" style={{ gap: 'var(--spacing-lg)' }}>
            <CheckboxItem label={checkboxLabel} />
            <div className="flex flex-1" style={{ gap: 'var(--spacing-lg)', minWidth: 0 }}>
              <div className="flex-1" style={{ minWidth: buttonMinWidth }}>
                <CapsuleButton size="large" variant="secondary" className="w-full" onClick={onSecondaryClick || emptyFn}>
                  {secondaryLabel}
                </CapsuleButton>
              </div>
              <div className="flex-1" style={{ minWidth: buttonMinWidth }}>
                <CapsuleButton size="large" variant="primary" className="w-full" onClick={onPrimaryClick || emptyFn}>
                  {primaryLabel}
                </CapsuleButton>
              </div>
            </div>
          </div>
        )

      /* ── 7. 三个按钮并列 ── */
      case 'triple':
        return (
          <div className="flex w-full" style={{ gap: 'var(--spacing-lg)' }}>
            <div className="flex-1" style={{ minWidth: 0 }}>
              <CapsuleButton size="large" variant="secondary" className="w-full" onClick={onThirdClick || emptyFn}>
                {thirdLabel}
              </CapsuleButton>
            </div>
            <div className="flex-1" style={{ minWidth: 0 }}>
              <CapsuleButton size="large" variant="secondary" className="w-full" onClick={onSecondaryClick || emptyFn}>
                {secondaryLabel}
              </CapsuleButton>
            </div>
            <div className="flex-1" style={{ minWidth: 0 }}>
              <CapsuleButton size="large" variant="primary" className="w-full" onClick={onPrimaryClick || emptyFn}>
                {primaryLabel}
              </CapsuleButton>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      className={className}
      style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: fluid ? '100%' : width,
        minWidth: fluid ? 0 : undefined,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: fluid ? '100%' : 360,
          minWidth: fluid ? 0 : 328,
          // When embedded fluidly (e.g. a dialog/sheet footer) the host already
          // supplies horizontal padding; adding the page-level 16px here too
          // squeezes the buttons until short labels wrap. Keep only top spacing.
          padding: fluid ? 'var(--spacing-md) 0 0' : 'var(--spacing-xl) var(--spacing-xl) 0',
          boxSizing: 'border-box',
        }}
      >
        {/* 按钮内容区 - 40px 高度 */}
        <div style={{ width: '100%', minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  )
}

export default ButtonBar
