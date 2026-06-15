import React from 'react'
import { Clock, Users } from 'lucide-react'

// ==================== 类型 ====================

export interface Course {
  title: string
  subtitle?: string
  /** 日期（可选，不传时不显示日期行） */
  date?: string
  /** 学习人数（可选，不传时不显示人数行） */
  students?: number
  /** 图片 URL */
  image?: string
  /** 纯色渐变兜底 */
  gradient?: string
}

interface CourseListItemProps {
  course: Course
  onClick?: () => void
  /** 自定义元信息区域，不传时默认显示日期 + 学习人数 */
  renderMeta?: (course: Course) => React.ReactNode
}

// ==================== 默认元信息 ====================

const DefaultMeta: React.FC<{ course: Course }> = ({ course }) => (
  <div className="flex flex-col" style={{ gap: 4, marginTop: 4 }}>
    {course.date && (
      <div className="flex items-center" style={{ gap: 8 }}>
        <Clock size={12} style={{ color: 'var(--color-text-hint)' }} />
        <span className="font-caption-s" style={{ color: 'var(--color-text-muted)' }}>
          {course.date}
        </span>
      </div>
    )}
    {course.students !== undefined && (
      <div className="flex items-center" style={{ gap: 8 }}>
        <Users size={12} style={{ color: 'var(--color-text-hint)' }} />
        <span className="font-caption-s" style={{ color: 'var(--color-text-muted)' }}>
          {course.students.toLocaleString()}人学习
        </span>
      </div>
    )}
  </div>
)

// ==================== 课程列表项 ====================

/** 课程列表项 — 左文右图内容行，不带卡片容器，由父级管理背景/分割线 */
const CourseListItem: React.FC<CourseListItemProps> = ({ course, onClick, renderMeta }) => {
  return (
    <div
      onClick={onClick}
      className="flex items-center cursor-pointer border-0"
      style={{ gap: 'var(--spacing-lg)' }}
    >
      {/* 左侧 120×68 圆角图片 */}
      <div
        className="rounded-[var(--radius-lg)] flex-shrink-0"
        style={{
          width: 120,
          height: 68,
          background: course.image
            ? `url(${course.image}) center/cover`
            : course.gradient || 'var(--color-bg-disabled)',
        }}
      />

      {/* 右侧内容 */}
      <div className="flex flex-col justify-center flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        <span className="font-headline-xs line-clamp-2" style={{ color: 'var(--color-text-primary)' }}>
          {course.title}
          {course.subtitle ? ` ${course.subtitle}` : ''}
        </span>
        {renderMeta ? renderMeta(course) : <DefaultMeta course={course} />}
      </div>
    </div>
  )
}

export default CourseListItem
