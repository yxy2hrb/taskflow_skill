import React from 'react'
import LeftSidebar from '@/components/LeftSidebar'
import FilterPills from '@/components/FilterPills'
import ProductCard from '@/components/ProductCard'
import type { Product } from '@/components/ProductCard'

// ==================== 类型定义 ====================

interface FilterItem {
  id: string
  name: string
}

interface SubFilter {
  id: string
  name: string
}

interface ProductLayoutProps {
  filters: FilterItem[]
  activeFilter: string
  onFilterChange: (id: string) => void
  subFilters: SubFilter[]
  activeSubFilter: string
  onSubFilterChange: (id: string) => void
  products: Product[]
  onProductClick?: (product: Product) => void
  onAddToCart?: (product: Product) => void
}

// ==================== 主组件 ====================

const ProductLayout: React.FC<ProductLayoutProps> = ({
  filters,
  activeFilter,
  onFilterChange,
  subFilters,
  activeSubFilter,
  onSubFilterChange,
  products,
  onProductClick,
  onAddToCart,
}) => {
  return (
    // 撑满父级剩余空间，flex row
    <div className="flex flex-1 overflow-hidden">
      {/* 左侧纵向筛选 - 高度跟随父级撑满 */}
      <LeftSidebar
        filters={filters}
        activeId={activeFilter}
        onChange={onFilterChange}
      />

      {/* 右侧内容区 - flex col，内部再分胶囊筛选 + 产品列表 */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ paddingLeft: 'var(--spacing-md)' }}>
        {/* 顶部胶囊筛选 */}
        <FilterPills
          filters={subFilters}
          activeId={activeSubFilter}
          onChange={onSubFilterChange}
        />

        {/* 产品列表 - 填满剩余空间，独立滚动 */}
        <div className="flex-1 overflow-y-auto py-2.5 space-y-2">
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--color-text-muted)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-40">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p className="font-body-m" style={{ color: 'var(--color-text-muted)' }}>暂无相关产品</p>
            </div>
          ) : (
            products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onClick={() => onProductClick?.(product)}
                onAddToCart={onAddToCart}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default ProductLayout
