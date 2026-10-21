import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const inputVariants = cva(
  'ui-input min-h-11 w-full min-w-0 px-2.5 py-1 text-base placeholder:text-[var(--muted-foreground)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 md:text-sm',
  {
    variants: {
      variant: {
        default:
          'ui-input-default rounded-[4px] border border-[var(--line-strong)] bg-[var(--sheet)]',
        underline:
          'ui-input-underline rounded-none border-0 border-b border-dashed border-[var(--line-strong)] bg-transparent px-0',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'> & VariantProps<typeof inputVariants>>(
  function Input({ className, type, variant = 'default', ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(inputVariants({ variant }), className)}
        {...props}
      />
    );
  },
);

export { Input, inputVariants };
