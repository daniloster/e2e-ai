// /get client entry: the site CSS, the boot (consent banner, badge bindings), then the store
// redirect. site.css comes first so the module stylesheets win on equal specificity.
import '../site.css';
import layout from '../layout/Layout.module.css';
import consent from '../layout/ConsentBanner.module.css';
import badges from '../ui/StoreBadges.module.css';
import get from '../pages/Get.module.css';
import { bootSite } from './boot';
import { mountGetPage } from './get';

// Vite marks CSS Modules side-effect free, so a bare import is tree-shaken and its stylesheet
// dropped from the build; this runtime read of one class per module keeps each in the bundle.
void document.getElementsByClassName(layout.skip ?? '');
void document.getElementsByClassName(consent.banner ?? '');
void document.getElementsByClassName(badges.badges ?? '');
void document.getElementsByClassName(get.get ?? '');

bootSite(window);
mountGetPage(window);
