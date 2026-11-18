// A site page section with an optional labelled <h2>. Text comes from the caller's t().
import type { JSX, ReactNode } from 'react';

import styles from './Section.module.css';

export interface SectionProps {
  id?: string;
  heading?: string;
  tone?: 'plain' | 'raised';
  children: ReactNode;
}

function cx(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function Section(props: SectionProps): JSX.Element {
  const { id, heading, tone = 'plain', children } = props;
  const headingId = id !== undefined && heading !== undefined ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx(styles.section, tone === 'raised' ? styles.raised : undefined) || undefined}
    >
      <div className={styles.inner}>
        {heading !== undefined && <h2 id={headingId}>{heading}</h2>}
        {children}
      </div>
    </section>
  );
}
