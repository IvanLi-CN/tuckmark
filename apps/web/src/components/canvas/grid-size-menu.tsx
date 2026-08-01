import { Grid2X2 } from "lucide-react"
import {
  CANVAS_GRID_SIZES,
  type CanvasGridSize,
  formatCanvasGridSize,
} from "../../lib/canvas-grid.js"
import { CanvasToolbarMenu } from "./canvas-toolbar-menu.js"

export type GridSizeMenuProps = {
  disabled?: boolean
  gridEnabled: boolean
  value: CanvasGridSize
  onChange: (value: CanvasGridSize) => void
  onToggle: () => void
}

function GridSizeMenu({ disabled, gridEnabled, onChange, onToggle, value }: GridSizeMenuProps) {
  return (
    <CanvasToolbarMenu
      ariaLabel="网格"
      buttonLabel="网格"
      disabled={disabled}
      icon={<Grid2X2 className="size-4" />}
      menuLabel="网格尺寸"
      options={CANVAS_GRID_SIZES.map((size) => ({
        value: size,
        label: formatCanvasGridSize(size),
      }))}
      pressed={gridEnabled}
      value={value}
      onChange={onChange}
      onToggle={onToggle}
    />
  )
}

export { GridSizeMenu }
