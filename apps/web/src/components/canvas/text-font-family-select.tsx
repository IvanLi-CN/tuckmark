import {
  getTextFontDefinition,
  getTextFontFamilyStack,
  type TextFontFamily,
} from "../../../../../packages/core/src/web.js"
import { textFontGroups } from "../../lib/text-fonts.js"
import { cn } from "../../lib/utils.js"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "../ui/select.js"

type TextFontFamilySelectProps = {
  className?: string
  disabled?: boolean
  id?: string
  onValueChange: (value: TextFontFamily) => void
  value: TextFontFamily
}

export function TextFontFamilySelect({
  className,
  disabled,
  id,
  onValueChange,
  value,
}: TextFontFamilySelectProps) {
  const selectedFont = getTextFontDefinition(value)

  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as TextFontFamily)}
    >
      <SelectTrigger id={id} className={className}>
        <span
          className="truncate text-left"
          style={{ fontFamily: getTextFontFamilyStack(selectedFont.id) }}
        >
          {selectedFont.label}
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-[22rem]">
        {textFontGroups.map((group, index) => (
          <div key={group.id}>
            {index > 0 ? <SelectSeparator /> : null}
            <SelectGroup>
              <SelectLabel>{group.label}</SelectLabel>
              {group.fonts.map((fontDefinition) => (
                <SelectItem
                  key={fontDefinition.id}
                  value={fontDefinition.id}
                  className={cn(fontDefinition.compatOnly && "text-muted-foreground")}
                >
                  <span
                    className="truncate"
                    style={{ fontFamily: getTextFontFamilyStack(fontDefinition.id) }}
                  >
                    {fontDefinition.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </div>
        ))}
      </SelectContent>
    </Select>
  )
}
