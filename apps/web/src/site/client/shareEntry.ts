// /s client entry: the site CSS, the boot, then the hand-off to the app (client/share.ts).
import '../site.css';
import layout from '../layout/Layout.module.css';
import consent from '../layout/ConsentBanner.module.css';
import button from '../ui/Button.module.css';
import badges from '../ui/StoreBadges.module.css';
import content from '../pages/Content.module.css';
import { bootSite } from './boot';
import { mountShareLanding } from './share';

// Vite marks CSS Modules side-effect free, so a bare import is tree-shaken and its stylesheet
// dropped from the build; this runtime read of one class per module keeps each in the bundle.
void document.getElementsByClassName(layout.skip ?? '');
void document.getElementsByClassName(consent.banner ?? '');
void document.getElementsByClassName(button.button ?? '');
void document.getElementsByClassName(badges.badges ?? '');
void document.getElementsByClassName(content.page ?? '');

bootSite(window);
mountShareLanding(window);
