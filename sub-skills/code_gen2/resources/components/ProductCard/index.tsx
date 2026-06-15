import React from 'react'
import { Plus } from 'lucide-react'

export interface Product {
  id: string
  name: string
  description?: string
  image?: string
  price: number
}

interface ProductCardProps {
  product: Product
  onClick?: () => void
  onAddToCart?: (product: Product) => void
}

// ==================== 产品图片占位 ====================

const ProductImagePlaceholder: React.FC = () => (
  <div
    className="flex-shrink-0 rounded-[var(--radius-md)] flex items-center justify-center"
    style={{ width: 64, height: 64, backgroundColor: 'var(--color-bg-disabled)' }}
  >
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c0c0c0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  </div>
)

// ==================== 产品卡片 ====================

const ProductCard: React.FC<ProductCardProps> = ({ product, onClick, onAddToCart }) => {
  return (
    <div
      onClick={onClick}
      className="flex items-center bg-white rounded-[var(--radius-lg)] border-0 active:scale-[0.98] transition-transform duration-150 cursor-pointer"
      style={{ width: 264, height: 90, gap: 'var(--spacing-lg)', padding: 'var(--spacing-md) var(--spacing-lg) var(--spacing-md) var(--spacing-md)' }}
    >
      {/* 产品图片区域 */}
      <div style={{ flexShrink: 0 }}>
        <ProductImagePlaceholder />
      </div>

      {/* 产品信息 */}
      <div
        className="flex flex-col min-w-0 relative"
        style={{ width: 168, height: 74 }}
      >
        {/* 标题 - 单行省略 */}
        <h3
className="truncate font-headline-xxs"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {product.name}
        </h3>

        {/* 三级文本描述 - 固定28px高度，占两行 */}
        <p
className="font-caption-s"
          style={{ marginTop: 'var(--spacing-xs)', height: 28, color: 'var(--color-text-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
        >
          {product.description || '\u00A0\n\u00A0'}
        </p>

        {/* 价格行 + 添加按钮 */}
        <div className="flex items-center justify-between" style={{ marginTop: 'var(--spacing-xs)' }}>
          <div className="flex items-baseline gap-0">
            <span
className="font-headline-xxs"
              style={{ color: 'var(--color-primary)' }}
            >
              ¥{product.price.toLocaleString()}
            </span>
          </div>

          {/* 添加按钮 - 20px圆形 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAddToCart?.(product)
            }}
            className="w-5 h-5 rounded-[var(--radius-full)] flex items-center justify-center bg-[var(--color-primary)] active:opacity-80 transition-opacity flex-shrink-0"
          >
            <Plus size={10} color="white" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProductCard
