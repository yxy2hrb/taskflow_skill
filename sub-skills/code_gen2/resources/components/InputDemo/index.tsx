import React from 'react'

/* ──────────────────────────────
   InputDemo — 线条输入框演示组件
   与 ButtonBar 联动使用
   ────────────────────────────── */

export interface InputDemoHandle {
  /** 触发校验，返回是否通过 */
  validate: () => boolean
  /** 清空输入和错误 */
  clear: () => void
  /** 当前输入值 */
  value: string
}

export interface InputDemoProps {
  /** 标签文字，默认「标题名称」 */
  label?: string
  /** 占位文字，默认「提示示例」 */
  placeholder?: string
  /** 错误提示文字，默认「输入错误请修正」 */
  errorMessage?: string
  /** 当前值（受控） */
  value?: string
  /** 值变化回调 */
  onChange?: (value: string) => void
  /** 自定义校验：返回错误文案或 null */
  validate?: (value: string) => string | null | undefined
  /** 禁用 */
  disabled?: boolean
  /** 显示右侧可见/隐藏切换图标（类似密码输入框） */
  showToggle?: boolean
  className?: string
}

/** ⬩ 眼睛图标 — 显示 */
const EyeOpenIcon: React.FC<{ size?: number; color?: string }> = ({ size = 20, color = 'rgba(0,0,0,0.4)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
    <path
      d="M12 5C7.5 5 3.5 8 2 12c1.5 4 5.5 7 10 7s8.5-3 10-7c-1.5-4-5.5-7-10-7z"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
    />
    <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>
)

/** ⬩ 眼睛图标 — 隐藏 */
const EyeClosedIcon: React.FC<{ size?: number; color?: string }> = ({ size = 20, color = 'rgba(0,0,0,0.4)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
    <path
      d="M12 5C7.5 5 3.5 8 2 12c1.5 4 5.5 7 10 7s8.5-3 10-7c-1.5-4-5.5-7-10-7z"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
    />
    <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <line x1="4" y1="4" x2="20" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const InputDemo = React.forwardRef<InputDemoHandle, InputDemoProps>(({
  label = '标题名称',
  placeholder = '提示示例',
  errorMessage = '输入错误请修正',
  value: controlledValue,
  onChange,
  validate,
  disabled = false,
  showToggle = false,
  className = '',
}, ref) => {
  const [internalValue, setInternalValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState(false)
  const [hidden, setHidden] = React.useState(showToggle)

  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue : internalValue

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!isControlled) setInternalValue(v)
    onChange?.(v)
    if (error) setError(null)
  }

  const handleFocus = () => setFocused(true)
  const handleBlur = () => setFocused(false)

  const triggerValidation = React.useCallback((): boolean => {
    if (disabled) return true

    if (validate) {
      const err = validate(currentValue)
      if (err) {
        setError(err)
        return false
      }
      setError(null)
      return true
    }

    if (!currentValue.trim()) {
      setError(errorMessage)
      return false
    }

    setError(null)
    return true
  }, [currentValue, disabled, validate, errorMessage])

  React.useImperativeHandle(ref, () => ({
    validate: triggerValidation,
    clear: () => {
      if (!isControlled) setInternalValue('')
      setError(null)
    },
    value: currentValue,
  }))

  const borderColor = error
    ? 'var(--color-error)'
    : focused
      ? 'var(--color-primary)'
      : 'var(--color-border-subtle)'

  const iconColor = error ? 'var(--color-error)' : 'rgba(0,0,0,0.4)'

  return (
    <div className={className} style={{ width: '100%' }}>
      {/* Label */}
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: 14,
            fontFamily: 'HarmonyOS Sans SC, sans-serif',
            fontWeight: 500,
            lineHeight: '20px',
            color: error ? 'var(--color-error)' : 'var(--color-text-primary)',
            marginBottom: 8,
          }}
        >
          {label}
        </label>
      )}

      {/* 线条输入框 + 切换图标 */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type={showToggle && hidden ? 'password' : 'text'}
          value={currentValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={placeholder}
          style={{
            width: '100%',
            height: 40,
            padding: '10px 0',
            paddingRight: showToggle ? 28 : 0,
            border: 'none',
            borderBottom: `1px solid ${borderColor}`,
            outline: 'none',
            backgroundColor: 'transparent',
            fontSize: 16,
            fontFamily: 'HarmonyOS Sans SC, sans-serif',
            lineHeight: '20px',
            caretColor: 'var(--color-primary)',
            color: disabled ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
            transition: 'border-color 150ms ease',
            boxSizing: 'border-box',
          }}
        />

        {/* 可见/隐藏切换图标 */}
        {showToggle && (
          <button
            type="button"
            onClick={() => setHidden(!hidden)}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: 0,
              bottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
            }}
            disabled={disabled}
            aria-label={hidden ? '显示内容' : '隐藏内容'}
          >
            {hidden ? <EyeClosedIcon size={20} color={iconColor} /> : <EyeOpenIcon size={20} color={iconColor} />}
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            fontSize: 12,
            fontFamily: 'HarmonyOS Sans SC, sans-serif',
            lineHeight: '16px',
            color: 'var(--color-error)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <rect x="6.3" y="3.5" width="1.4" height="4.2" rx="0.7" fill="currentColor" />
            <rect x="6.3" y="8.7" width="1.4" height="1.4" rx="0.7" fill="currentColor" />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  )
})

InputDemo.displayName = 'InputDemo'
export default InputDemo
