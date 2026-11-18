// A site link styled as a primary or secondary button. Every site action is
// navigation, so it is always an <a>; real <button>s belong to the consent banner and the language suggestion.
import type { AnchorHTMLAttributes, JSX } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  variant?: ButtonVariant;
}

// Module classes are undefined under Vitest, so empty entries are dropped.
function cx(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

// Forwards every other attribute (data-*, rel, aria-*) to the <a>.
export function Button(props: ButtonProps): JSX.Element {
  const { variant = 'primary', className, children, ...rest } = props;
  return (
    <a {...rest} className={cx(styles.button, styles[variant], className) || undefined}>
      {children}
    </a>
  );
}
