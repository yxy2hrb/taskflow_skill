/* eslint-disable react-refresh/only-export-components */
import React from 'react'

// ==================== 类型 ====================

export type StatusColorConfig = {
  color: string
  bgColor: string
}

/** 默认状态颜色映射（覆盖此值可自定义） */
export const DEFAULT_STATUS_COLORS: Record<string, StatusColorConfig> = {
  '进行中': { color: 'var(--color-primary)', bgColor: 'rgba(199,0,11,0.05)' },
  '待开始': { color: 'var(--color-text-muted)', bgColor: 'rgba(0,0,0,0.05)' },
  '已完成': { color: 'var(--color-success)', bgColor: 'rgba(16,185,129,0.1)' },
  '跟进中': { color: 'var(--color-primary)', bgColor: 'rgba(199,0,11,0.05)' },
  '已签约': { color: 'var(--color-success)', bgColor: 'rgba(16,185,129,0.1)' },
  '意向高': { color: 'var(--color-warning)', bgColor: 'rgba(249,115,22,0.1)' },
  '待付款': { color: 'var(--color-warning)', bgColor: 'rgba(249,115,22,0.1)' },
  '待发货': { color: 'var(--color-primary)', bgColor: 'rgba(199,0,11,0.05)' },
  '已发货': { color: '#3B82F6', bgColor: 'rgba(59,130,246,0.1)' },
  '已完成_alt': { color: 'var(--color-success)', bgColor: 'rgba(16,185,129,0.1)' },
  '严重': { color: 'var(--color-error)', bgColor: 'rgba(239,68,68,0.1)' },
  '警告': { color: 'var(--color-warning)', bgColor: 'rgba(249,115,22,0.1)' },
  '通知': { color: '#3B82F6', bgColor: 'rgba(59,130,246,0.1)' },
}

interface StatusPillProps {
  text: string
  /** 自定义颜色配置，会合并到默认配置之上 */
  colorMap?: Record<string, StatusColorConfig>
}

// ==================== 状态胶囊 ====================

/**
 * StatusPill — 状态标签胶囊
 *
 * 根据 text 自动匹配颜色，未匹配时回退为灰色。
 *
 * 样式规范：
 * - 字号 10px，行高 12px，字重 regular(400)
 * - 左右 8px padding，圆角 full
 * - 文本颜色和背景由 status→color/bgColor 映射决定
 */
const StatusPill: React.FC<StatusPillProps> = ({ text, colorMap }) => {
  const mergedColors = { ...DEFAULT_STATUS_COLORS, ...colorMap }
  const config = mergedColors[text]

  return (
    <span
      className="font-caption-s rounded-[var(--radius-full)]"
      style={{
        color: config?.color ?? 'var(--color-text-muted)',
        backgroundColor: config?.bgColor ?? 'rgba(0,0,0,0.05)',
        padding: '1px 8px',
      }}
    >
      {text}
    </span>
  )
}

export default StatusPill
