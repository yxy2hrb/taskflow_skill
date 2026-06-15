import React from 'react'

/* ───────────────────────
   类型
   ─────────────────────── */

export interface CapsuleButtonProps {
  children: React.ReactNode
  /** large=40px / small=28px */
  size?: 'large' | 'small'
  /** primary(强调) / secondary(次要) / secondary-primary(次要强调) */
  variant?: 'primary' | 'secondary' | 'secondary-primary'
  disabled?: boolean
  /** 左侧图标 */
  icon?: React.ReactNode
  className?: string
  onClick?: () => void
}

export interface TextButtonProps {
  children: React.ReactNode
  /** large=20px / medium=16px / small=14px */
  size?: 'large' | 'medium' | 'small'
  /** primary(强调红色) / secondary(次要黑色) */
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  /** 右侧图标 */
  icon?: React.ReactNode
  className?: string
  onClick?: () => void
}

/* ─── 图标尺寸映射 ─── */

const iconSize: Record<string, number> = {
  'capsule-large': 20,
  'capsule-small': 14,
  'text-large': 20,
  'text-medium': 16,
  'text-small': 14,
}

/* ───────────────────────
   CapsuleButton — 胶囊按钮
   ─────────────────────── */

const capsuleSizeStyles: Record<string, React.CSSProperties> = {
  large: { height: 40, paddingLeft: 28, paddingRight: 28 },
  small: { height: 28, paddingLeft: 'var(--spacing-lg)', paddingRight: 'var(--spacing-lg)' },
}

const capsuleFontClass: Record<string, string> = {
  large: 'font-headline-s',
  small: 'font-headline-xxs',
}

function getCapsuleStyle(variant: string, disabled: boolean): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: disabled ? 'var(--color-primary-disabled)' : 'var(--color-primary)',
      color: 'var(--color-text-white)',
    },
    secondary: {
      backgroundColor: disabled ? 'var(--color-bg-disabled)' : 'var(--color-bg-disabled)',
      color: disabled ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
    },
    'secondary-primary': {
      backgroundColor: disabled ? 'var(--color-bg-disabled)' : 'var(--color-bg-disabled)',
      color: disabled ? 'var(--color-primary-disabled)' : 'var(--color-primary)',
    },
  }
  return map[variant] || map.primary
}

function renderCapsuleIcon(icon: React.ReactNode, size: number): React.ReactNode {
  if (!icon) return null
  return React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size })
}

export const CapsuleButton: React.FC<CapsuleButtonProps> = ({
  children,
  size = 'large',
  variant = 'primary',
  disabled = false,
  icon,
  className,
  onClick,
}) => {
  return (
    <button
      className={`inline-flex items-center justify-center border-none rounded-[var(--radius-full)] tap-scale ${capsuleFontClass[size]} ${className || ''}`}
      style={{
        ...capsuleSizeStyles[size],
        ...getCapsuleStyle(variant, disabled),
        gap: 'var(--spacing-xs)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon && renderCapsuleIcon(icon, iconSize[`capsule-${size}`])}
      {children}
    </button>
  )
}

/* ───────────────────────
   TextButton — 文本按钮
   ─────────────────────── */

const textButtonFontClass: Record<string, string> = {
  large: 'font-headline-s',
  medium: 'font-headline-xs',
  small: 'font-headline-xxs',
}

function getTextColor(variant: string, disabled: boolean): string {
  if (disabled) {
    return variant === 'primary' ? 'var(--color-primary-disabled)' : 'var(--color-text-disabled)'
  }
  return variant === 'primary' ? 'var(--color-primary)' : 'var(--color-text-primary)'
}

export const TextButton: React.FC<TextButtonProps> = ({
  children,
  size = 'medium',
  variant = 'primary',
  disabled = false,
  icon,
  className,
  onClick,
}) => {
  const isz = iconSize[`text-${size}`]
  const color = getTextColor(variant, disabled)

  return (
    <button
      className={`inline-flex items-center bg-transparent border-none tap-scale ${textButtonFontClass[size]} ${className || ''}`}
      style={{
        gap: 'var(--spacing-xs)',
        padding: 'var(--spacing-xs) 0',
        color,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
      {icon && (
        React.cloneElement(icon as React.ReactElement<{ size?: number; color?: string }>, {
          size: isz,
          color,
        })
      )}
    </button>
  )
}
