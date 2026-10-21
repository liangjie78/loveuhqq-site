import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'ui-button inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 border px-3 py-1 font-[inherit] text-sm no-underline transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default:
          'ui-button-default rounded-[3px] border-[var(--line-stronger)] bg-[var(--sheet)] font-[var(--serif)] text-[var(--ink)] hover:border-[var(--rose)] hover:text-[var(--rose)] active:bg-[var(--paper-2)]',
        ghost:
          'ui-button-ghost rounded-none border-transparent bg-transparent text-[var(--muted-foreground)] underline decoration-[var(--line-strong)] underline-offset-4 hover:text-[var(--ink)]',
        ink:
          'ui-button-ink min-h-[46px] rounded-full border-transparent bg-[var(--ink)] px-6 text-[var(--paper)] tracking-[.08em] hover:-translate-y-0.5 hover:bg-[var(--ink-soft)]',
      },
      tone: {
        default: '',
        danger: 'ui-button-danger text-[var(--rose-deep)] hover:text-[var(--rose)]',
      },
    },
    defaultVariants: { variant: 'default', tone: 'default' },
  },
);

function Button({
  className,
  variant = 'default',
  tone = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, tone }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
