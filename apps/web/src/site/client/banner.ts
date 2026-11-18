// Shows and hides the site consent banner, records the choice and manages focus.
// Knows nothing about analytics: bootSite passes the choice callbacks. Plain DOM code.
import { writeConsent, type ConsentState } from './consent';

export interface BannerDeps {
  state: ConsentState;
  storage: Pick<Storage, 'setItem'> | null;
  now(): number;
  /** After the record is written and the banner hidden. */
  onGrant(): void;
  onRefuse(): void;
}

// Missing markup -> no-op. unknown -> reveal (no focus move). Settings -> reveal + focus Allow. Escape = No thanks.
export function mountConsentBanner(doc: Document, deps: BannerDeps): void {
  const banner = doc.querySelector<HTMLElement>('[data-consent-banner]');
  const accept = banner?.querySelector<HTMLButtonElement>('[data-consent="accept"]');
  const decline = banner?.querySelector<HTMLButtonElement>('[data-consent="decline"]');
  if (!banner || !accept || !decline) return;
  const settings = doc.querySelector<HTMLElement>('[data-consent-settings]');
  let opener: HTMLElement | null = null;

  function choose(analytics: boolean): void {
    if (!banner) return;
    const hadFocus = banner.contains(doc.activeElement);
    // Store first, so the choice is remembered even if loading the facade later fails.
    writeConsent(deps.storage, analytics, deps.now());
    banner.hidden = true;
    if (hadFocus) (opener ?? doc.getElementById('main'))?.focus();
    opener = null;
    if (analytics) deps.onGrant();
    else deps.onRefuse();
  }

  accept.addEventListener('click', () => choose(true));
  decline.addEventListener('click', () => choose(false));
  banner.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || banner.hidden) return;
    event.preventDefault();
    choose(false);
  });

  if (settings) {
    settings.hidden = false;
    settings.addEventListener('click', () => {
      banner.hidden = false;
      opener = settings;
      accept.focus();
    });
  }
  if (deps.state === 'unknown') banner.hidden = false;
}
