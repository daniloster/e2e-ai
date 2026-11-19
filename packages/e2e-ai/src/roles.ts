// Native element types → the engine's roles, for every platform the drivers read. One vocabulary
// lets one plan replay on web, iOS and Android, and lets grounding and @global triggers treat a
// permission prompt, an alert, a bottom sheet or a modal the same way everywhere.
//
// Teams extend or override the maps in e2e-ai.config.json:
//   "ui": { "roles": { "android": { "com.acme.ui.PrimaryButton": "button" },
//                      "ios": { "XCUIElementTypeOther:paywall": "dialog" },
//                      "web": { "acme-button": "button", "sl-dialog": "dialog" } } }
// Keys are the native type (iOS element type, Android class — full or simple name, web tag or ARIA
// role); values are roles from ROLES. MCP driver servers receive the same maps through E2E_ROLES.

/** The engine's roles. Containers (dialog, alert, sheet…) carry their title as name. */
export const ROLES = [
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'menu',
  'menuitem',
  'listitem',
  'list',
  'row',
  'heading',
  'text',
  'image',
  'progressbar',
  'dialog',
  'alert',
  'group',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles that cover the screen: what @global rules and humans call modals, sheets, alerts, prompts. */
export const OVERLAY_ROLES: ReadonlySet<string> = new Set(['dialog', 'alert']);

export const IOS_ROLES: Record<string, Role> = {
  XCUIElementTypeButton: 'button',
  XCUIElementTypeLink: 'link',
  XCUIElementTypeTextField: 'textbox',
  XCUIElementTypeSecureTextField: 'textbox',
  XCUIElementTypeTextView: 'textbox',
  XCUIElementTypeSearchField: 'textbox',
  XCUIElementTypeStaticText: 'text',
  XCUIElementTypeSwitch: 'checkbox',
  XCUIElementTypeToggle: 'checkbox',
  XCUIElementTypeCheckBox: 'checkbox',
  XCUIElementTypeRadioButton: 'radio',
  XCUIElementTypeCell: 'listitem',
  XCUIElementTypeTable: 'list',
  XCUIElementTypeCollectionView: 'list',
  XCUIElementTypeImage: 'image',
  XCUIElementTypeIcon: 'image',
  XCUIElementTypeSlider: 'slider',
  XCUIElementTypeStepper: 'spinbutton',
  XCUIElementTypePicker: 'combobox',
  XCUIElementTypePickerWheel: 'combobox',
  XCUIElementTypeDatePicker: 'combobox',
  XCUIElementTypePopUpButton: 'combobox',
  XCUIElementTypeComboBox: 'combobox',
  XCUIElementTypeSegmentedControl: 'tablist',
  XCUIElementTypeTabBar: 'tablist',
  XCUIElementTypeTab: 'tab',
  XCUIElementTypeMenu: 'menu',
  XCUIElementTypeMenuBar: 'menu',
  XCUIElementTypeMenuItem: 'menuitem',
  XCUIElementTypeMenuButton: 'button',
  XCUIElementTypeProgressIndicator: 'progressbar',
  XCUIElementTypeActivityIndicator: 'progressbar',
  XCUIElementTypePageIndicator: 'progressbar',
  // Overlays: system alerts (permissions, "Save Password?"), action sheets, sheets, popovers.
  XCUIElementTypeAlert: 'alert',
  XCUIElementTypeSheet: 'dialog',
  XCUIElementTypeDialog: 'dialog',
  XCUIElementTypePopover: 'dialog',
  XCUIElementTypeNavigationBar: 'heading',
};

/** Android classes by simple name (the package is ignored: android.widget, androidx, material…). */
export const ANDROID_ROLES: Record<string, Role> = {
  Button: 'button',
  ImageButton: 'button',
  MaterialButton: 'button',
  FloatingActionButton: 'button',
  ExtendedFloatingActionButton: 'button',
  Chip: 'button',
  EditText: 'textbox',
  AutoCompleteTextView: 'textbox',
  MultiAutoCompleteTextView: 'textbox',
  TextInputEditText: 'textbox',
  AppCompatEditText: 'textbox',
  SearchView: 'textbox',
  CheckBox: 'checkbox',
  MaterialCheckBox: 'checkbox',
  Switch: 'checkbox',
  SwitchCompat: 'checkbox',
  SwitchMaterial: 'checkbox',
  MaterialSwitch: 'checkbox',
  ToggleButton: 'checkbox',
  CheckedTextView: 'checkbox',
  RadioButton: 'radio',
  MaterialRadioButton: 'radio',
  Spinner: 'combobox',
  AppCompatSpinner: 'combobox',
  NumberPicker: 'spinbutton',
  SeekBar: 'slider',
  Slider: 'slider',
  RatingBar: 'slider',
  ProgressBar: 'progressbar',
  CircularProgressIndicator: 'progressbar',
  LinearProgressIndicator: 'progressbar',
  ImageView: 'image',
  AppCompatImageView: 'image',
  TextView: 'text',
  AppCompatTextView: 'text',
  MaterialTextView: 'text',
  RecyclerView: 'list',
  ListView: 'list',
  GridView: 'list',
  TabLayout: 'tablist',
  TabWidget: 'tablist',
  TabView: 'tab',
  'TabLayout$TabView': 'tab',
  // React Native host views as UiAutomator sees them.
  ReactEditText: 'textbox',
  ReactTextView: 'text',
  ReactImageView: 'image',
  ReactSwitch: 'checkbox',
};

/**
 * Android resource ids that mark an overlay, its title or its message: AlertDialog
 * (android:id/alertTitle, android:id/message), runtime permission prompts (permission controller),
 * Material bottom sheets.
 */
export const ANDROID_OVERLAY_IDS: Record<string, { role: Role; part: 'title' | 'message' | 'container' }> = {
  // The framework's AlertDialog: exact ids, so an app view with testID "message" is not an alert.
  'android:id/alertTitle': { role: 'alert', part: 'title' },
  'android:id/message': { role: 'alert', part: 'message' },
  'android:id/parentPanel': { role: 'alert', part: 'container' },
  // Any package's id with this name (permission controllers, Material bottom sheets).
  ':id/permission_message': { role: 'dialog', part: 'title' },
  ':id/grant_dialog': { role: 'dialog', part: 'container' },
  ':id/design_bottom_sheet': { role: 'dialog', part: 'container' },
};

/** Which overlay part a full Android resource id marks, if any. */
export function androidOverlay(resourceId: string): { role: Role; part: 'title' | 'message' | 'container' } | undefined {
  if (!resourceId) return undefined;
  const exact = ANDROID_OVERLAY_IDS[resourceId];
  if (exact) return exact;
  const i = resourceId.indexOf(':id/');
  return i > 0 && !resourceId.startsWith('android:') ? ANDROID_OVERLAY_IDS[resourceId.slice(i)] : undefined;
}

/** Packages whose windows are the system's, not the app's (permission prompts, system dialogs). */
export const ANDROID_SYSTEM_PACKAGES = ['com.android.permissioncontroller', 'com.google.android.permissioncontroller', 'com.android.systemui', 'android'];

export const WEB_ROLES: Record<string, Role> = {
  button: 'button',
  a: 'link',
  textarea: 'textbox',
  select: 'combobox',
  img: 'image',
  dialog: 'dialog',
  alertdialog: 'alert',
  progress: 'progressbar',
  meter: 'progressbar',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  li: 'listitem',
  ul: 'list',
  ol: 'list',
  tr: 'row',
  summary: 'button',
  option: 'menuitem',
  switch: 'checkbox',
  searchbox: 'textbox',
  menuitemcheckbox: 'checkbox',
  menuitemradio: 'radio',
  gridcell: 'listitem',
  treeitem: 'listitem',
  paragraph: 'text',
  generic: 'text',
  StaticText: 'text',
};

export interface RoleConfig {
  ios?: Record<string, string>;
  android?: Record<string, string>;
  web?: Record<string, string>;
}

let custom: RoleConfig = {};

/** Installs the config's role maps (a config with no `ui.roles` resets them). */
export function configureRoles(c: RoleConfig | undefined): void {
  for (const [platform, map] of Object.entries(c ?? {})) {
    for (const [k, v] of Object.entries((map ?? {}) as Record<string, string>)) {
      if (!(ROLES as readonly string[]).includes(v)) throw new Error(`ui.roles.${platform}["${k}"]: "${v}" is not a role (${ROLES.join(', ')})`);
    }
  }
  custom = c ?? {};
}

/** Role maps handed to MCP driver servers (they run in their own process). */
export function rolesFromEnv(): void {
  if (process.env.E2E_ROLES) configureRoles(JSON.parse(process.env.E2E_ROLES) as RoleConfig);
}

export const currentRoles = (): RoleConfig => custom;

/** iOS: a custom key may name a type, or `Type:identifier` for one element. */
export function iosRole(type: string, identifier = ''): string {
  return custom.ios?.[`${type}:${identifier}`] ?? custom.ios?.[type] ?? IOS_ROLES[type] ?? '';
}

export function androidRole(cls: string, s: { clickable: boolean; checkable: boolean; text: string }): string {
  const simple = cls.split(/[.]/).pop() ?? cls;
  const configured = custom.android?.[cls] ?? custom.android?.[simple];
  if (configured) return configured;
  if (s.checkable) return ANDROID_ROLES[simple] === 'radio' ? 'radio' : 'checkbox';
  const known = ANDROID_ROLES[simple];
  if (known === 'textbox' || known === 'combobox' || known === 'slider' || known === 'spinbutton' || known === 'tab') return known;
  // A clickable view is a button whatever it is drawn with (RN Pressable = ViewGroup).
  if (s.clickable) return known === 'link' ? 'link' : known === 'image' || known === 'text' || !known || known === 'list' ? 'button' : known;
  return known ?? (s.text ? 'text' : '');
}

/** Web: a tag or ARIA role → role (custom first, so web components can be mapped). */
export function webRole(tagOrRole: string): string {
  return custom.web?.[tagOrRole] ?? WEB_ROLES[tagOrRole] ?? '';
}

/**
 * What the OS shows over any app, in its own words. Given to the planner of @global rules next to
 * the app guide, so a rule like "allow notifications when asked" can trigger on a system prompt the
 * app's docs never describe. Quoted texts are on-screen literals (see globals.ts groundTriggers).
 */
export const SYSTEM_SCREENS = `System screens (shown by the operating system over any app):
- Android permission prompt: "Allow", "Don't allow", "While using the app", "Only this time", "Allow all the time"; messages like "send you notifications", "access this device's location", "take pictures and record video", "record audio", "access photos and videos".
- iOS permission alert: "Allow", "Don't Allow", "Allow Once", "Allow While Using App", "Allow Full Access", "Limit Access", "Ask App Not to Track"; titles like "Would Like to Send You Notifications", "Would Like to Access", "to use your location".
- iOS system sheets: "Save Password", "Not Now", "Never for This Website", "Open in", "Cancel", "OK".
- Android dialogs: "OK", "Cancel", "Close app", "Wait" ("isn't responding").`;
