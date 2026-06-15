/** 模拟系统状态栏：时间 + 华为 Mate 三挖孔 + 信号/WiFi/电池图标 */

const StatusBar = () => {
  return (
    <div className="flex-shrink-0 flex items-center justify-between" style={{ height: 36, padding: `0 var(--spacing-xl)` }}>
      {/* 左侧 — 时间 */}
      <span className="font-headline-s" style={{ color: 'var(--color-text-primary)' }}>9:41</span>

      {/* 中央 — 华为 Mate 80 三挖孔 */}
      <div className="flex items-center justify-center" style={{ gap: 16, position: 'absolute', left: '50%', marginLeft: -46 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: '#1C1C1E' }} />
        <div style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: '#1C1C1E' }} />
        <div style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: '#1C1C1E' }} />
      </div>

      {/* 右侧 — 信号/WiFi/电池 */}
      <div className="flex items-center" style={{ gap: 'var(--spacing-xs)' }}>
        <svg viewBox="0 0 16 10" fill="none" style={{ height: 13 }}>
          <rect x="0" y="6" width="3" height="4" rx="0.5" fill="#1C1C1E"/>
          <rect x="4.5" y="4" width="3" height="6" rx="0.5" fill="#1C1C1E"/>
          <rect x="9" y="2" width="3" height="8" rx="0.5" fill="#1C1C1E"/>
          <rect x="13.5" y="0" width="2.5" height="10" rx="0.5" fill="#1C1C1E"/>
        </svg>
        <svg viewBox="0 0 14 10" fill="none" style={{ height: 13 }}>
          <path d="M7 8.5a1 1 0 100-2 1 1 0 000 2z" fill="#1C1C1E"/>
          <path d="M4 6.2a4.2 4.2 0 016 0" stroke="#1C1C1E" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M1.5 4a7.5 7.5 0 0111 0" stroke="#1C1C1E" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <svg viewBox="0 0 22 11" fill="none" style={{ height: 13 }}>
          <rect x="0.5" y="0.5" width="18" height="10" rx="2.5" stroke="#1C1C1E" strokeOpacity="0.35"/>
          <rect x="1.5" y="1.5" width="14" height="8" rx="1.5" fill="#1C1C1E"/>
          <path d="M19.5 3.5v4a1.5 1.5 0 000-4z" fill="#1C1C1E" fillOpacity="0.4"/>
        </svg>
      </div>
    </div>
  )
}

export default StatusBar
