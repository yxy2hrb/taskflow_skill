# Code Gen2 组件库参考

本文档说明 `code_gen2/resources/components` 中的规范组件、props 与推荐使用场景，供 component-codegen / page-layer 选择组件形态时参考。

## 总体原则

- 组件依赖 `../global.css` 中的设计变量，如 `--color-primary`、`--color-bg-card`、`--radius-lg`、`--spacing-xl`、`font-headline-*`。
- 组件默认面向 360px 宽移动端页面。
- codegen 应优先复用本组件库里的稳定形态，避免重复生成风格不一致的按钮、卡片、筛选、导航。
- page-layer 阶段不要输出大段组件 HTML/CSS，应使用组件占位符：`<div class="tf-component-placeholder" data-component-id="component_id"></div>`。
- 保留原始 D2C 区域时使用 keep 占位符：`<div class="tf-keep-placeholder" data-keep-anchor="语义锚点名"></div>`。

## 布局与外壳

### `MobileLayout`

固定 360 x 792 的移动端页面外壳，包含模拟状态栏、主内容区、底部导航和二级页面覆盖层。

Props:

- `children: React.ReactNode`：页面主体内容。

使用场景:

- 完整应用预览页面。
- 需要状态栏、底部导航、二级页面遮罩动画的路由页面。

注意:

- 依赖 `react-router-dom`、`BottomNav`、`StatusBar` 和业务 store。
- 静态 taskflow layer 通常不直接使用完整外壳，而是继承原始页面或复用其布局规范。

### `SectionLayout`

楼层容器，组合标题、可选页签和内容区。

Props:

- `variant: 'browse' | 'card'`：`browse` 为透明背景，`card` 为白色圆角卡片。
- `title: string`：楼层标题。
- `moreText?: string`：更多按钮文案，默认 `更多`。
- `onMore?: () => void`：更多按钮回调。
- `tabs?: { id: string; label: string }[]`：页签列表。
- `activeTab?: string`：当前页签 id。
- `onTabChange?: (id: string) => void`：页签切换。
- `headerRightAction?: React.ReactNode`：标题右侧自定义内容。
- `children: React.ReactNode`：楼层内容。

使用场景:

- `browse`：资讯、直播、课程、案例等浏览型内容。
- `card`：工具、工作台、快捷入口、商城模块等操作型内容。

### `SectionTitle`

标题行组件，包含标题和右侧操作。

Props:

- `variant: 'browse' | 'card'`：所在楼层上下文。
- `title: string`：标题文字。
- `onMore?: () => void`：显示内置 `MoreButton`。
- `moreText?: string`：更多按钮文案。
- `headerRightAction?: React.ReactNode`：右侧自定义内容，优先级高于 `onMore`。

使用场景:

- 楼层标题。
- 卡片标题行。

## 导航组件

### `StatusBar`

模拟系统状态栏，展示时间、挖孔、信号、Wi-Fi、电池。

Props:

- 无。

使用场景:

- 完整移动端页面预览。
- 若原始页面已有状态栏，taskflow layer 优先使用 `tf-keep-placeholder` 继承。

### `TopNav`

顶部导航栏，高度 56px，支持页签、标题和抽屉式标题。

Props:

- `variant?: 'tabs' | 'title' | 'drawer'`：导航形态，默认 `tabs`。
- `onBack?: () => void`：传入后显示返回按钮。
- `activeTab?: string`：`tabs` 模式当前项。
- `tabs?: string[]`：`tabs` 模式页签列表。
- `onTabChange?: (tab: string) => void`：页签切换。
- `title?: string`：`title` 模式标题。
- `drawerValue?: string`：`drawer` 模式当前值。
- `drawerOptions?: string[]`：`drawer` 模式选项。
- `onDrawerChange?: (value: string) => void`：抽屉切换。
- `drawerDefaultOpen?: boolean`：默认展开抽屉，主要用于预览。
- `actions: ('search' | 'cart' | 'profile' | 'scan' | 'message' | 'settings' | 'grid')[]`：右侧操作，最多显示 3 个。
- `cartCount?: number`：购物车角标。
- `onSearch? / onCart? / onProfile? / onScan? / onMessage? / onSettings? / onGrid?: () => void`：对应操作回调。

使用场景:

- 一级页面：`tabs` 或 `title`。
- 二级页面：`onBack` + `title`。
- 需要切换上下文：`drawer`。

### `BottomNav`

底部五栏导航，固定 64px 高。

Props:

- 无外部 props。

使用场景:

- 应用主框架底部导航。

注意:

- 依赖路由与 `workspaceStore`。
- 静态 taskflow layer 中通常通过 keep placeholder 继承原始底部导航。

### `UnderlineTabs`

横向下划线 Tab，支持自动滚动到选中项。

Props:

- `tabs: { id: string; label: string }[]`：页签数据。
- `activeId: string`：当前选中项。
- `onChange: (id: string) => void`：切换回调。
- `size?: 'default' | 'sm'`：尺寸，默认 `default`。
- `className?: string`：扩展类名。

使用场景:

- 页面级 Tab。
- 卡片内部子 Tab。
- 非筛选语义的同级内容切换。

### `CategoryTabs`

产品图片横滑分类页签。

Props:

- `categories: { id: string; name: string; image?: string }[]`：分类项。
- `activeId: string`：当前分类。
- `onChange: (id: string) => void`：切换回调。

使用场景:

- 商城产品分类。
- 图文产品系列切换。

## 按钮与表单

### `CapsuleButton`

胶囊按钮，来自 `components/ui/Button` 的命名导出。

Props:

- `children: React.ReactNode`：按钮内容。
- `size?: 'large' | 'small'`：`large` 高 40px，`small` 高 28px。
- `variant?: 'primary' | 'secondary' | 'secondary-primary'`：按钮样式。
- `disabled?: boolean`：禁用。
- `icon?: React.ReactNode`：左侧图标。
- `className?: string`：扩展类。
- `onClick?: () => void`：点击回调。

使用场景:

- 主按钮、次按钮、底部操作栏按钮。
- 确认、提交、取消、加入购物车等动作。

### `TextButton`

文本按钮，来自 `components/ui/Button` 的命名导出。

Props:

- `children: React.ReactNode`：按钮内容。
- `size?: 'large' | 'medium' | 'small'`：字号尺寸。
- `variant?: 'primary' | 'secondary'`：强调色或次要色。
- `disabled?: boolean`：禁用。
- `icon?: React.ReactNode`：右侧图标。
- `className?: string`：扩展类。
- `onClick?: () => void`：点击回调。

使用场景:

- “更多”“查看全部”“编辑”“跳过”等弱操作。

### `ButtonBar`

按钮操作栏，支持 7 种布局组合。

Props:

- `variant: 'single-primary' | 'single-secondary' | 'input-primary' | 'input-secondary' | 'dual' | 'checkbox-dual' | 'triple'`：布局变体。
- `primaryLabel?: string`：主按钮文案。
- `secondaryLabel?: string`：次按钮文案。
- `thirdLabel?: string`：第三按钮文案，仅 `triple` 有效。
- `inputPlaceholder?: string`：输入框占位文案。
- `checkboxLabel?: string`：复选框文案。
- `width?: number | "100%"`：容器宽度，默认 360；`360` 适用于顶层底部操作栏，嵌套在弹窗/卡片/footer 内时传 `"100%"` 以服从父容器宽度。
- `className?: string`：扩展类。
- `onPrimaryClick?: () => void`：主按钮回调。
- `onSecondaryClick?: () => void`：次按钮回调。
- `onThirdClick?: () => void`：第三按钮回调。

使用约束:

- 顶层底部操作区可使用默认 `width=360`。
- 作为 `Dialog`/`Modal`/卡片 footer 的子组件时，必须传 `width="100%"` 或生成等价的紧凑按钮行；不要让默认 360 宽度突破父容器。

使用场景:

- 表单底部确认栏。
- 双按钮/三按钮操作栏。
- 输入框 + 按钮组合。
- 勾选协议 + 操作按钮组合。

### `InputDemo`

线条输入框，支持受控/非受控、校验、错误提示和可见/隐藏切换。

Props:

- `label?: string`：标签，默认 `标题名称`。
- `placeholder?: string`：占位文字，默认 `提示示例`。
- `errorMessage?: string`：默认错误文案。
- `value?: string`：受控值。
- `onChange?: (value: string) => void`：值变化。
- `validate?: (value: string) => string | null | undefined`：自定义校验。
- `disabled?: boolean`：禁用。
- `showToggle?: boolean`：显示可见/隐藏切换。
- `className?: string`：扩展类。

Ref:

- `validate: () => boolean`：触发校验。
- `clear: () => void`：清空值和错误。
- `value: string`：当前值。

使用场景:

- 项目名称、配单名称、账号、密码等表单输入。
- 需要错误态提示的输入项。

## 筛选与状态

### `FilterPills`

横向胶囊筛选。

Props:

- `filters: { id: string; name: string }[]`：筛选项。
- `activeId: string`：当前选中项。
- `onChange: (id: string) => void`：切换回调。
- `fadeEdges?: boolean`：是否显示左右渐隐遮罩。

使用场景:

- 商品子分类。
- 状态筛选。
- 标签筛选。

### `LeftSidebar`

左侧纵向筛选栏，宽 72px。

Props:

- `filters: { id: string; name: string }[]`：筛选项。
- `activeId: string`：当前选中项。
- `onChange: (id: string) => void`：切换回调。

使用场景:

- 商城左侧一级分类。
- 双栏筛选页。

### `StatusPill`

状态标签胶囊，根据文案映射颜色。

Props:

- `text: string`：状态文案。
- `colorMap?: Record<string, { color: string; bgColor: string }>`：自定义颜色映射。

默认状态:

- `进行中`、`待开始`、`已完成`
- `跟进中`、`已签约`、`意向高`
- `待付款`、`待发货`、`已发货`
- `严重`、`警告`、`通知`

使用场景:

- 订单状态。
- 线索状态。
- 风险等级。
- 消息类型。

## 商品与列表

### `ProductLayout`

产品页组合布局：左侧分类 + 顶部胶囊筛选 + 产品列表。

Props:

- `filters: { id: string; name: string }[]`：左侧一级筛选。
- `activeFilter: string`：当前一级筛选。
- `onFilterChange: (id: string) => void`：一级筛选切换。
- `subFilters: { id: string; name: string }[]`：子筛选。
- `activeSubFilter: string`：当前子筛选。
- `onSubFilterChange: (id: string) => void`：子筛选切换。
- `products: Product[]`：产品列表。
- `onProductClick?: (product: Product) => void`：产品点击。
- `onAddToCart?: (product: Product) => void`：加入购物车。

使用场景:

- 标准产品列表页。
- 左分类右商品列表的商城页面。

### `ProductCard`

商品卡片，固定 264 x 90，左图右文，右下角加号。

Props:

- `product: { id: string; name: string; description?: string; image?: string; price: number }`：商品数据。
- `onClick?: () => void`：卡片点击。
- `onAddToCart?: (product: Product) => void`：加号点击。

使用场景:

- 商品列表项。
- 商品选择、加入购物车、进入详情页入口。

注意:

- 当前实现使用图片占位，`image` 字段未直接渲染真实图片。

### `ProductSelectionListItem`

配单/报价单列表项，包含 Logo、名称、状态、时间、流转和更多菜单。

Props:

- `item: { id: string; name: string; status: '谈单中' | '已成单' | '未成单'; scene?: string; time: string }`：列表项。
- `onForward?: (id: string) => void`：流转操作。
- `onMore?: (id: string) => void`：更多点击。
- `onStatusChange?: (id: string, status: '谈单中' | '已成单' | '未成单') => void`：状态修改。
- `isLast?: boolean`：是否最后一项。

使用场景:

- 配单列表。
- 报价单列表。
- 可快速修改状态的业务列表。

### `CourseListItem`

课程/内容列表项，左图右文。

Props:

- `course: { title: string; subtitle?: string; date?: string; students?: number; image?: string; gradient?: string }`：课程数据。
- `onClick?: () => void`：点击回调。
- `renderMeta?: (course: Course) => React.ReactNode`：自定义元信息。

使用场景:

- 课程列表。
- 资讯列表。
- 直播回放列表。

### `HotVideoCard`

上图下文视频卡片，支持默认小卡和 livestream 大卡布局。

Props:

- `title: string`：标题。
- `subtitle?: string`：副标题，传 `action` 时显示。
- `imageGradient: string`：封面背景，可为 CSS 渐变、data URL 或 http(s) URL。
- `imageHeight?: number`：封面高度，默认 90。
- `width?: number | string`：卡片宽度，默认 160。
- `tag?: string`：标签文本。
- `action?: React.ReactNode`：右侧操作插槽，传入后切换大卡布局。
- `onShare?: () => void`：分享回调。
- `onClick?: () => void`：卡片点击。

使用场景:

- 热门视频。
- 直播入口。
- 活动视频卡片。

## 入口与网格

### `IconGrid`

通用图标阵列，支持纯网格和卡片包裹。

Props:

- `cols: number`：列数，通常为 3 或 4。
- `items: { icon: React.ElementType; label: string; color: string }[]`：图标项。
- `title?: string`：标题，仅 `card` 变体显示。
- `variant?: 'plain' | 'card'`：默认 `plain`。
- `emptyText?: string`：空数据文案，默认 `暂无数据`。

使用场景:

- 功能入口阵列。
- 工具入口。
- 工作台快捷操作。

### `QuickEntryGrid`

快捷入口 3 列网格，白色卡片包裹。

Props:

- `items: { icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number }>; label: string; color: string }[]`：入口项。
- `title?: string`：可选标题。

使用场景:

- 首页快捷入口。
- 工作台快捷入口。

### `EntryCard`

左文右图入口卡片，默认 158 x 58。

Props:

- `card: { id: string; title: string; subtitle: string; color: string; bgColor: string; iconBg: string; icon?: string }`：入口数据。
- `width?: number`：宽度，默认 158。
- `height?: number`：高度，默认 58。

使用场景:

- 首页双列入口卡。
- 产品、场景、问卷、扫码等轻量入口。

### `MoreButton`

“更多 + 右箭头”文本按钮。

Props:

- `onClick?: () => void`：点击回调。
- `text?: string`：文案，默认 `更多`。

使用场景:

- 楼层标题右侧操作。
- `SectionTitle` 内置更多按钮。

## Codegen 选型建议

- 顶栏优先使用 `TopNav`；原始页已有顶栏时优先 keep 原始锚点。
- 底部主操作优先使用 `ButtonBar` 或 `CapsuleButton`。
- 筛选语义使用 `FilterPills` / `LeftSidebar`；导航切换语义使用 `UnderlineTabs` / `CategoryTabs`。
- 商品列表优先组合 `ProductLayout` + `ProductCard`。
- 配单/报价列表优先使用 `ProductSelectionListItem`。
- 表单输入优先使用 `InputDemo`，提交区域使用 `ButtonBar`。
- 状态标签、风险等级、订单状态优先使用 `StatusPill`。
- 功能宫格优先使用 `IconGrid` / `QuickEntryGrid`，入口卡片使用 `EntryCard`。
- 视频和课程内容优先使用 `HotVideoCard` / `CourseListItem`。

## 默认尺寸与 bbox 建议

生成 `state_implementation_model` 时，`bbox` 应优先参考组件默认尺寸；如业务状态需要更大容器，可以使用外层容器包裹，而不是强行拉伸内部固定尺寸组件。

- `StatusBar`：高度 `36`，宽度通常为 `360`。
- `TopNav`：高度 `56`，宽度通常为 `360`。二级页一般放在 `y=36`。
- `BottomNav`：高度 `64`，宽度通常为 `360`。默认贴底。
- `ButtonBar`：默认宽度 `360`，内容区按钮高度 `40`，外层实际建议高度 `64` 至 `72`。底部固定操作栏建议 `bbox=[0, height-64, 360, 64]`。
- `CapsuleButton`：`large` 高 `40`，`small` 高 `28`。宽度由父容器或 `className` 决定。
- `TextButton`：高度随字号，常用操作区建议预留 `24` 至 `32`。
- `InputDemo`：输入行高度 `40`；含 label 和错误信息时建议预留 `72` 至 `92`。
- `UnderlineTabs`：页面级建议高度 `36` 至 `44`，卡片内 `sm` 建议高度 `32` 至 `40`。
- `CategoryTabs`：固定高度 `92`，宽度通常为 `360`。
- `FilterPills`：胶囊高度 `28`，外层含上下 padding 建议高度 `44` 至 `48`。
- `LeftSidebar`：宽度 `72`；每项高度 `46`。
- `SectionTitle`：建议高度 `24` 至 `32`。
- `SectionLayout`：根据内容变化；`card` 变体需要额外预留 `12` padding 和内部间距。
- `ProductCard`：固定宽度 `264`、高度 `90`。如果需要 `328` 宽列表项，优先使用自定义容器或新增适配组件，不要直接把 `ProductCard` bbox 写成 `328` 宽。
- `ProductLayout`：组合布局，通常占据页面主内容区剩余空间；左侧栏固定 `72` 宽。
- `ProductSelectionListItem`：单行主体高 `46`，含间距/分割线时建议每项预留 `59` 至 `72`。
- `CourseListItem`：图片固定 `120 x 68`，整行建议高度 `68` 至 `84`。
- `HotVideoCard`：默认宽度 `160`，默认封面高度 `90`；总高度取决于内容，常用小卡约 `160 x 170`。
- `QuickEntryGrid`：3 列网格，图标容器 `48 x 48`，白卡高度随行数变化。
- `IconGrid`：图标容器 `40 x 40`；3/4 列布局，外层高度随行数变化。
- `EntryCard`：默认宽度 `158`、高度 `58`。
- `StatusPill`：高度约 `14` 至 `18`，适合嵌入列表/卡片内。
- `MoreButton`：高度约 `24`，适合标题行右侧。

## 弹窗/遮罩与字体约束

- BottomSheet、Drawer、Modal、Dialog 这类弹层组件应作为完整组件承载自身标题、关闭按钮、清空操作、主体内容和底部操作区；不要把同一个弹窗拆成多个兄弟组件，除非子组件需要独立复用或独立动画。
- 遮罩与弹窗必须显式设置层级：遮罩建议 `props.zIndex = 50`，弹窗建议 `props.zIndex = 60` 或更高，Toast 等更高层反馈建议 `70` 或更高。
- 有可见文字的组件应携带 `text_style` 或 `props.textStyles`，字体 token 参考 `global.css`：页面标题用 `font-headline-xxl`，卡片标题/主按钮用 `font-headline-s`，紧凑标题用 `font-headline-xs`，正文用 `font-body-m`，辅助文案用 `font-caption-m`，标签用 `font-caption-s`。
- `text_style` 推荐包含 `className`、`fontSize`、`lineHeight`、`fontWeight`、`color`。component-codegen 应优先使用这些属性，而不是重新猜测字号。

## State height 与长页面

- `state_implementation_model.states[].height` 是每个状态的实际画布高度。
- 如果内容能放进初始视口，`height` 等于 `viewport.initial_height`。
- 如果卡片、列表或详情内容过多，允许 `height` 大于初始视口；bbox 可以继续向下排列，避免压缩内容导致空卡片或信息缺失。
- page-layer 会把 `height` 用作对应 state layer 的 `min-height`，截图时也会按该 state 的 `height` 设置 Playwright viewport。
- 生成 bbox 时，所有可见组件的 `bbox[1] + bbox[3]` 不应超过该 state 的 `height`。
