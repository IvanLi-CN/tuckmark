import { ScanSearch } from "lucide-react"
import {
  CANVAS_SNAP_STEPS,
  type CanvasSnapStep,
  formatCanvasSnapStep,
} from "../../lib/canvas-grid.js"
import { CanvasToolbarMenu } from "./canvas-toolbar-menu.js"

export type SnapStepMenuProps = {
  disabled?: boolean
  snapEnabled: boolean
  value: CanvasSnapStep
  onChange: (value: CanvasSnapStep) => void
  onToggle: () => void
}

function SnapStepMenu({ disabled, onChange, onToggle, snapEnabled, value }: SnapStepMenuProps) {
  return (
    <CanvasToolbarMenu
      ariaLabel="吸附"
      buttonLabel="吸附"
      disabled={disabled}
      icon={<ScanSearch className="size-4" />}
      menuLabel="吸附步长"
      options={CANVAS_SNAP_STEPS.map((step) => ({
        value: step,
        label: formatCanvasSnapStep(step),
      }))}
      pressed={snapEnabled}
      value={value}
      onChange={onChange}
      onToggle={onToggle}
    />
  )
}

export { SnapStepMenu }
