import { afterEach, describe, expect, it } from 'vitest';

import { parseUiAutomator } from './drivers/adb.ts';
import { parseXcuiSource } from './drivers/appium.ts';
import { parsePlaywrightSnapshot } from './drivers/playwrightMcp.ts';
import { snapshotScript } from './drivers/web.ts';
import { groundTriggers } from './globals.ts';
import { androidRole, configureRoles, iosRole, SYSTEM_SCREENS, webRole } from './roles.ts';
import type { UiElement } from './types.ts';

afterEach(() => configureRoles(undefined));

const els = (nodes: { el: UiElement }[]) => nodes.map((n) => n.el);

describe('role maps', () => {
  it('maps Android classes by simple name, clickable views to buttons, checkables to checkbox/radio', () => {
    const s = (o: Partial<{ clickable: boolean; checkable: boolean; text: string }>) => ({ clickable: false, checkable: false, text: '', ...o });
    expect(androidRole('com.google.android.material.textfield.TextInputEditText', s({}))).toBe('textbox');
    expect(androidRole('android.widget.Spinner', s({ clickable: true }))).toBe('combobox');
    expect(androidRole('android.widget.SeekBar', s({}))).toBe('slider');
    expect(androidRole('android.widget.RadioButton', s({ checkable: true }))).toBe('radio');
    expect(androidRole('androidx.appcompat.widget.SwitchCompat', s({ checkable: true }))).toBe('checkbox');
    expect(androidRole('android.view.ViewGroup', s({ clickable: true }))).toBe('button'); // RN Pressable
    expect(androidRole('android.widget.TextView', s({ text: 'Hi' }))).toBe('text');
    expect(androidRole('android.widget.ProgressBar', s({}))).toBe('progressbar');
    expect(androidRole('android.view.View', s({}))).toBe('');
  });

  it('maps iOS element types, overlays included', () => {
    expect(iosRole('XCUIElementTypeAlert')).toBe('alert');
    expect(iosRole('XCUIElementTypeSheet')).toBe('dialog');
    expect(iosRole('XCUIElementTypePickerWheel')).toBe('combobox');
    expect(iosRole('XCUIElementTypeSegmentedControl')).toBe('tablist');
    expect(iosRole('XCUIElementTypeOther')).toBe('');
  });

  it('takes the config’s maps first (class, simple name, iOS type:identifier, web tag) and rejects unknown roles', () => {
    configureRoles({
      android: { 'com.acme.ui.PrimaryButton': 'button', StarRating: 'slider' },
      ios: { 'XCUIElementTypeOther:paywall': 'dialog' },
      web: { 'sl-dialog': 'dialog', 'acme-button': 'button' },
    });
    expect(androidRole('com.acme.ui.PrimaryButton', { clickable: false, checkable: false, text: '' })).toBe('button');
    expect(androidRole('com.acme.StarRating', { clickable: true, checkable: false, text: '' })).toBe('slider');
    expect(iosRole('XCUIElementTypeOther', 'paywall')).toBe('dialog');
    expect(iosRole('XCUIElementTypeOther', 'other')).toBe('');
    expect(webRole('sl-dialog')).toBe('dialog');
    expect(() => configureRoles({ web: { 'x-y': 'banana' } })).toThrow('"banana" is not a role');
  });
});

describe('overlays in native page sources', () => {
  it('Android runtime permission prompt (Appium source): a dialog named by its message, with its buttons', () => {
    const xml = `<hierarchy>
  <android.widget.FrameLayout package="com.google.android.permissioncontroller" class="android.widget.FrameLayout" resource-id="com.android.permissioncontroller:id/grant_dialog" bounds="[60,800][1020,1700]">
    <android.widget.TextView package="com.google.android.permissioncontroller" class="android.widget.TextView" text="Allow Pocket Notes to send you notifications?" resource-id="com.android.permissioncontroller:id/permission_message" bounds="[100,900][980,1000]"/>
    <android.widget.Button package="com.google.android.permissioncontroller" class="android.widget.Button" text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" clickable="true" bounds="[100,1300][980,1400]"/>
    <android.widget.Button package="com.google.android.permissioncontroller" class="android.widget.Button" text="Don’t allow" resource-id="com.android.permissioncontroller:id/permission_deny_button" clickable="true" bounds="[100,1450][980,1550]"/>
  </android.widget.FrameLayout>
</hierarchy>`;
    const e = els(parseUiAutomator(xml));
    expect(e.find((x) => x.role === 'dialog')).toMatchObject({ name: 'Allow Pocket Notes to send you notifications?' });
    expect(e.filter((x) => x.role === 'button').map((x) => [x.name, x.testId])).toEqual([
      ['Allow', 'permission_allow_button'],
      ['Don’t allow', 'permission_deny_button'],
    ]);
  });

  it('Android AlertDialog: an alert named by its title, carrying its message', () => {
    const xml = `<hierarchy>
  <node class="android.widget.LinearLayout" package="com.pocketnotes.dev" resource-id="android:id/parentPanel" bounds="[80,900][1000,1500]"/>
  <node class="android.widget.TextView" package="com.pocketnotes.dev" text="Delete note?" resource-id="android:id/alertTitle" bounds="[120,950][960,1010]"/>
  <node class="android.widget.TextView" package="com.pocketnotes.dev" text="This cannot be undone." resource-id="android:id/message" bounds="[120,1050][960,1110]"/>
  <node class="android.widget.Button" package="com.pocketnotes.dev" text="DELETE" resource-id="android:id/button1" clickable="true" bounds="[700,1380][960,1460]"/>
</hierarchy>`;
    const e = els(parseUiAutomator(xml));
    expect(e.find((x) => x.role === 'alert')).toMatchObject({ name: 'Delete note?', text: 'This cannot be undone.' });
    expect(e.find((x) => x.role === 'button')).toMatchObject({ name: 'DELETE', testId: 'button1' });
  });

  it('an app view whose testID happens to be "message" is not a system alert', () => {
    const xml = `<hierarchy><node class="android.widget.TextView" package="com.pocketnotes.dev" text="Saved" resource-id="message" bounds="[0,0][100,40]"/></hierarchy>`;
    expect(els(parseUiAutomator(xml)).map((x) => x.role)).toEqual(['text']);
  });

  it('iOS system alert (XCUITest source): an alert named by its title, with its buttons', () => {
    const xml = `<XCUIElementTypeApplication name="Pocket Notes" visible="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeAlert name="“Pocket Notes” Would Like to Send You Notifications" label="“Pocket Notes” Would Like to Send You Notifications" visible="true" x="52" y="300" width="286" height="230">
    <XCUIElementTypeStaticText name="Notifications may include alerts." label="Notifications may include alerts." visible="true" x="68" y="360" width="254" height="40"/>
    <XCUIElementTypeButton name="Don’t Allow" label="Don’t Allow" visible="true" x="52" y="480" width="143" height="50"/>
    <XCUIElementTypeButton name="Allow" label="Allow" visible="true" x="195" y="480" width="143" height="50"/>
  </XCUIElementTypeAlert>
</XCUIElementTypeApplication>`;
    const e = els(parseXcuiSource(xml));
    expect(e.find((x) => x.role === 'alert')).toMatchObject({ name: '“Pocket Notes” Would Like to Send You Notifications' });
    expect(e.filter((x) => x.role === 'button').map((x) => x.name)).toEqual(['Don’t Allow', 'Allow']);
  });

  it('@playwright/mcp ARIA roles go through the same map', () => {
    const snap = '```yaml\n- alertdialog "Delete note?" [ref=e3]\n- switch "Dark mode" [checked] [ref=e4]\n- paragraph [ref=e5]: Hello\n```';
    expect(parsePlaywrightSnapshot(snap).map((e) => [e.role, e.name])).toEqual([
      ['alert', 'Delete note?'],
      ['checkbox', 'Dark mode'],
      ['text', 'Hello'],
    ]);
  });
});

describe('web snapshot in a real browser', () => {
  it('names dialogs by their heading and maps native and custom elements', { timeout: 60_000 }, async () => {
    configureRoles({ web: { 'acme-button': 'button' } });
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <main>
          <acme-button data-testid="buy" style="display:block;width:80px;height:20px">Buy</acme-button>
          <input type="radio" aria-label="Small"><input type="range" aria-label="Volume">
          <div role="switch" aria-checked="true" aria-label="Sync" style="width:20px;height:20px"></div>
        </main>
        <dialog open><h2>Delete note?</h2><p>This cannot be undone.</p><button>Delete</button></dialog>
        <div role="alertdialog" aria-label="Session expired" style="width:50px;height:50px">Sign in again</div>`);
      const e = (await page.evaluate(snapshotScript())) as UiElement[];
      const by = (name: string) => e.find((x) => x.name === name);
      expect(by('Delete note?')).toMatchObject({ role: 'dialog' });
      expect(by('Session expired')).toMatchObject({ role: 'alert' });
      expect(by('Buy')).toMatchObject({ role: 'button', testId: 'buy' });
      expect(by('Small')?.role).toBe('radio');
      expect(by('Volume')?.role).toBe('slider');
      expect(by('Sync')).toMatchObject({ role: 'checkbox', checked: true });
      expect(by('Delete')?.role).toBe('button');
    } finally {
      await browser.close();
    }
  });
});

describe('@global rules and system screens', () => {
  it('accepts triggers on the OS’s own prompts, which no app guide describes', () => {
    const fixes: string[] = [];
    const docs = `Pocket Notes: a notes app.\n\n${SYSTEM_SCREENS}`;
    expect(groundTriggers(['send you notifications', 'Would Like to Send You Notifications'], docs, 'allow notifications when asked', fixes)).toEqual([
      'send you notifications',
      'Would Like to Send You Notifications',
    ]);
  });
});
