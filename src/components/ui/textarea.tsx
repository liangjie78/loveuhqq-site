import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const textareaVariants = cva(
  'ui-textarea min-h-16 w-full px-2.5 py-2 text-base placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60 md:text-sm',
  {
    variants: {
      variant: {
        default:
          'ui-textarea-default rounded-[3px] border border-[var(--line-strong)] bg-[var(--sheet)]',
        underline:
          'ui-textarea-underline rounded-none border-0 bg-transparent px-0',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Textarea({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Textarea, textareaVariants };
