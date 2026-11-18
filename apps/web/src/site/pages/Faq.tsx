// The FAQ: question headings with their answers, and one FAQPage object in the head.
import type { JSX } from 'react';
import type { SiteKey, SiteTranslator } from '@pn/i18n/site';

import type { RenderContext } from '../pages';
import styles from './Content.module.css';

const QUESTIONS: readonly (readonly [SiteKey, SiteKey])[] = Object.freeze([
  ['site.faq.free.q', 'site.faq.free.a'],
  ['site.faq.devices.q', 'site.faq.devices.a'],
  ['site.faq.account.q', 'site.faq.account.a'],
  ['site.faq.share.q', 'site.faq.share.a'],
  ['site.faq.offline.q', 'site.faq.offline.a'],
  ['site.faq.data.q', 'site.faq.data.a'],
  ['site.faq.languages.q', 'site.faq.languages.a'],
] as const);

export function Faq(props: { t: SiteTranslator; ctx: RenderContext }): JSX.Element {
  const { t } = props.t;
  return (
    <div className={styles.page}>
      <h1>{t('site.faq.heading')}</h1>
      <div className={styles.faq}>
        {QUESTIONS.map(([q, a]) => (
          <section key={q}>
            <h2>{t(q)}</h2>
            <p>{t(a)}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

export function faqJsonLd(t: SiteTranslator, ctx: RenderContext): readonly object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: ctx.locale,
      mainEntity: QUESTIONS.map(([q, a]) => ({
        '@type': 'Question',
        name: t.t(q),
        acceptedAnswer: { '@type': 'Answer', text: t.t(a) },
      })),
    },
  ];
}
