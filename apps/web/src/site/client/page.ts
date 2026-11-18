// Client entry of the content pages (home, FAQ, contact, support, your data): the
// site and page CSS, then the boot (consent banner, store badges, language suggestion). CSS and the
// boot only (no React, no catalog); site.css comes first so the module stylesheets win on equal
// specificity.
import '../site.css';
import layout from '../layout/Layout.module.css';
import consent from '../layout/ConsentBanner.module.css';
import section from '../ui/Section.module.css';
import button from '../ui/Button.module.css';
import badges from '../ui/StoreBadges.module.css';
import content from '../pages/Content.module.css';
import { bootSite } from './boot';

// Vite marks CSS Modules side-effect free, so a bare import is tree-shaken and its stylesheet
// dropped from the build; this runtime read of one class per module keeps each in the bundle.
void document.getElementsByClassName(layout.skip ?? '');
void document.getElementsByClassName(consent.banner ?? '');
void document.getElementsByClassName(section.section ?? '');
void document.getElementsByClassName(button.button ?? '');
void document.getElementsByClassName(badges.badges ?? '');
void document.getElementsByClassName(content.page ?? '');

bootSite(window);
