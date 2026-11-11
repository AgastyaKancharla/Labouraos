import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useFamily } from './family';

/**
 * Buttons from both design families. In portal screens a Button renders the
 * compact `.btn2` (12.5 px, 9×15 padding); in console/phone screens the
 * 44 px-tall `.btn` (comfortable to tap). `size` overrides the family default.
 *
 *   primary   .btn2.p / .btn.bp   main action (one per area)
 *   secondary .btn2   / .btn.bs   everything else
 *   danger    .btn2.d / .btn.bd   destructive (reject, lock, remove)
 *   success   .btn2.g / .btn.bg   approve / release
 *   navy      .btn.bn             strong neutral (console only; portal falls back to primary)
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'navy';
export type ButtonSize = 'compact' | 'regular';

export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra?: string, fullWidth?: boolean): string {
  const classes =
    size === 'compact'
      ? ['btn2', { primary: 'p', secondary: '', danger: 'd', success: 'g', navy: 'p' }[variant]]
      : ['btn', { primary: 'bp', secondary: 'bs', danger: 'bd', success: 'bg', navy: 'bn' }[variant]];
  if (fullWidth) classes.push('full');
  classes.push('lb-btn');
  if (extra) classes.push(extra);
  return classes.filter(Boolean).join(' ');
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
}

export interface ButtonProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size, fullWidth, icon, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const family = useFamily();
  const resolved = size ?? (family === 'portal' ? 'compact' : 'regular');
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, resolved, className, fullWidth)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="lb-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

export interface ButtonLinkProps extends CommonProps, LinkProps {}

/** A router link that looks like a button (for navigation, not actions). */
export function ButtonLink({ variant = 'secondary', size, fullWidth, icon, className, children, ...rest }: ButtonLinkProps) {
  const family = useFamily();
  const resolved = size ?? (family === 'portal' ? 'compact' : 'regular');
  return (
    <Link className={buttonClass(variant, resolved, className, fullWidth)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
