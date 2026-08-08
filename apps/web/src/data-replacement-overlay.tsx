export function DataReplacementOverlay({ active }: { active: boolean }) {
  if (!active) {
    return null
  }
  return (
    <div className="tm-runtime-replacement-overlay" role="status" aria-live="assertive">
      <div className="tm-runtime-replacement-overlay__panel">
        <strong>正在切换数据集</strong>
        <span>当前标签页会在替换完成后自动恢复。</span>
      </div>
    </div>
  )
}
