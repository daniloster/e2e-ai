// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_VALUE,
  appStoreUrl,
  campaignFrom,
  playStoreUrl,
  storeUrl,
  type Campaign,
} from './campaign';

const TIKTOK: Campaign = { source: 'tiktok', medium: 'paid', campaign: 'xmas26' };
const PLAY = 'https://play.google.com/store/apps/details?id=com.pocketnotes';

describe('campaignFrom', () => {
  it('keeps valid utm values, frozen', () => {
    const c = campaignFrom('?utm_source=tiktok&utm_medium=paid&utm_campaign=xmas26', 'home');
    expect(c).toEqual(TIKTOK);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('defaults to site / organic / the page id', () => {
    expect(campaignFrom('', 'support')).toEqual({
      source: 'site',
      medium: 'organic',
      campaign: 'support',
    });
  });

  it('defaults each invalid field on its own', () => {
    expect(campaignFrom('?utm_source=a%20b&utm_campaign=' + 'x'.repeat(41), 'get')).toEqual({
      source: 'site',
      medium: 'organic',
      campaign: 'get',
    });
    expect(campaignFrom('?utm_source=a+b&utm_medium=&utm_campaign=x.y', 'faq')).toEqual({
      source: 'site',
      medium: 'organic',
      campaign: 'faq',
    });
    expect(campaignFrom('?utm_medium=Paid_Social-1', 'home').medium).toBe('Paid_Social-1');
  });

  it('keeps a 40-character value and the first of repeated parameters', () => {
    const forty = 'x'.repeat(40);
    expect(campaignFrom(`?utm_campaign=${forty}`, 'home').campaign).toBe(forty);
    expect(campaignFrom('?utm_source=one&utm_source=two', 'home').source).toBe('one');
  });

  it('whitelists letters, digits, underscore and hyphen', () => {
    expect(CAMPAIGN_VALUE.test('Ab_9-z')).toBe(true);
    for (const bad of ['', 'a b', 'a&b', 'ñ', 'x'.repeat(41)])
      expect(CAMPAIGN_VALUE.test(bad)).toBe(false);
  });
});

describe('playStoreUrl', () => {
  it('adds one referrer, encoded once, keeping the base parameters', () => {
    const result = playStoreUrl(PLAY, TIKTOK);
    expect(result).toBe(
      'https://play.google.com/store/apps/details?id=com.pocketnotes&referrer=utm_source%3Dtiktok%26utm_medium%3Dpaid%26utm_campaign%3Dxmas26',
    );
    const params = new URL(result).searchParams;
    expect(params.getAll('referrer')).toEqual([
      'utm_source=tiktok&utm_medium=paid&utm_campaign=xmas26',
    ]);
    expect(params.get('id')).toBe('com.pocketnotes');
  });

  it('replaces an existing referrer', () => {
    const params = new URL(playStoreUrl(`${PLAY}&referrer=old`, TIKTOK)).searchParams;
    expect(params.getAll('referrer')).toEqual([
      'utm_source=tiktok&utm_medium=paid&utm_campaign=xmas26',
    ]);
  });

  it('throws on a relative base', () => {
    expect(() => playStoreUrl('/store', TIKTOK)).toThrow(TypeError);
  });
});

describe('appStoreUrl', () => {
  it('sets pt and ct and keeps mt=8', () => {
    const params = new URL(appStoreUrl('https://apps.apple.com/app/id123?mt=8', 'PT1', TIKTOK))
      .searchParams;
    expect(params.get('mt')).toBe('8');
    expect(params.get('pt')).toBe('PT1');
    expect(params.get('ct')).toBe('xmas26');
  });

  it('sets only ct without a provider token', () => {
    const params = new URL(appStoreUrl('https://apps.apple.com/app/id123?mt=8', null, TIKTOK))
      .searchParams;
    expect(params.get('mt')).toBe('8');
    expect(params.get('ct')).toBe('xmas26');
    expect(params.has('pt')).toBe(false);
  });

  it('replaces an existing pt and ct', () => {
    const params = new URL(
      appStoreUrl('https://apps.apple.com/app/id1?pt=old&ct=old', 'NEW', TIKTOK),
    ).searchParams;
    expect(params.getAll('pt')).toEqual(['NEW']);
    expect(params.getAll('ct')).toEqual(['xmas26']);
  });
});

describe('storeUrl', () => {
  const links = { appStore: 'https://apps.apple.com/app/id1', googlePlay: PLAY };

  it('maps each store to its builder', () => {
    expect(storeUrl('app_store', links, 'PT1', TIKTOK)).toBe(
      appStoreUrl(links.appStore, 'PT1', TIKTOK),
    );
    expect(storeUrl('google_play', links, 'PT1', TIKTOK)).toBe(playStoreUrl(PLAY, TIKTOK));
  });

  it('is null when that store has no link', () => {
    expect(
      storeUrl('app_store', { appStore: null, googlePlay: 'https://x' }, null, TIKTOK),
    ).toBeNull();
    expect(
      storeUrl('google_play', { appStore: links.appStore, googlePlay: null }, null, TIKTOK),
    ).toBeNull();
  });
});
