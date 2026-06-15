import React from 'react'
import { ChevronRight } from 'lucide-react'

interface MoreButtonProps {
  onClick?: () => void
  text?: string
}

const MoreButton: React.FC<MoreButtonProps> = ({ onClick, text = '更多' }) => {
  return (
    <button
      onClick={onClick}
      className="flex items-center bg-transparent border-none cursor-pointer"
      style={{ gap: 2 }}
    >
      <span className="font-headline-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {text}
      </span>
      <ChevronRight size={16} style={{ color: 'var(--color-text-secondary)' }} />
    </button>
  )
}

export default MoreButton
