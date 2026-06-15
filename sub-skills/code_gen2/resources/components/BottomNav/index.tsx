import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Store, LayoutDashboard, Wrench, User } from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspaceStore'

interface NavItem {
  path: string
  label: string
  icon: React.ElementType
  /** 是否使用动态标签（中间的工作台入口） */
  dynamicLabel?: boolean
}

const baseNavItems: NavItem[] = [
  { path: '/', label: '首页', icon: Home },
  { path: '/products', label: '商城', icon: Store },
  { path: '/projects', label: '工作台', icon: LayoutDashboard, dynamicLabel: true },
  { path: '/tools', label: '工具', icon: Wrench },
  { path: '/profile', label: '我的', icon: User },
]

/**
 * BottomNav - 底部导航栏
 *
 * 360px 宽 × 64px 高，5 个入口均分无间距
 * 中间"工作台"入口根据 workspaceStore 动态显示用户选择的短标签（工作台/营销/销售/交易/运营）
 * 选中态：品牌色线性图标（30×30 容器）+ 10px Bold 14px 行高文字
 * 未选中态：纯黑文字 Regular 字重
 */
const BottomNav: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { shortLabel } = useWorkspaceStore()

  const navItems = baseNavItems.map((item) => {
    if (item.dynamicLabel) {
      return { ...item, label: shortLabel }
    }
    return item
  })

  return (
    <nav
      className="flex-shrink-0 bg-white"
      style={{ height: 64 }}
    >
      <div className="flex w-full h-full">
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex-1 h-full flex flex-col items-center justify-center transition-colors"
              style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-primary)' }}
            >
              <div
                className="flex items-center justify-center"
                style={{ width: 30, height: 30 }}
              >
                <Icon size={24} />
              </div>
              <span className="font-caption-s">
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default BottomNav
