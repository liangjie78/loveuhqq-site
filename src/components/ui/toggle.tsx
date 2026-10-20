import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  'ui-button ui-toggle group/toggle inline-flex min-h-11 min-w-[4.5rem] cursor-pointer items-center justify-center gap-1 rounded-full border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] whitespace-nowrap transition-colors hover:border-[var(--rose)] hover:text-[var(--rose)] focus-visible:z-10 disabled:pointer-events-none disabled:opacity-60 data-[state=on]:border-[var(--rose)] data-[state=on]:bg-[var(--rose)] data-[state=on]:text-[var(--sheet)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: '',
        outline: '',
      },
      size: {
        default: '',
        sm: '',
        lg: '',
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
