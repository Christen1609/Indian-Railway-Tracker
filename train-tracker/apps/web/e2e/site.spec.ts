// Features: landing page, search, the 12951 page, another train's page, an unknown train

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SOURCE_NAMES = /railradar|confirmtkt|goibibo|railyatri|travelkhana|railmitra/i;

/** Fails the test on any uncaught page error */
function failOnPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('the landing page shows the search box', async ({ page }) => {
  const errors = failOnPageErrors(page);
  await page.goto('/');
  await expect(page.getByRole('combobox')).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveAttribute('placeholder', 'Number or name');
  expect(errors).toEqual([]);
});

test('searching by number finds 12951 and opens its page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox').fill('12951');
  const option = page.getByRole('option').filter({ hasText: '12951' }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/[?&]train=12951\b/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rajdhani');
});

test('searching by name finds trains beyond 12951', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox').fill('karnataka');
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: '12627' })).toBeVisible();
});

test('the 12951 page shows the train, its journey and a map', async ({ page }) => {
  const errors = failOnPageErrors(page);
  await page.goto('/?train=12951');
  await expect(page.getByRole('region', { name: 'Train status' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Journey' })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SOURCE_NAMES);
  expect(errors).toEqual([]);
});

test('another train (12627) shows its timetable or its live view', async ({ page }) => {
  const errors = failOnPageErrors(page);
  await page.goto('/?train=12627');
  const timetable = page.getByRole('list', { name: 'Timetable' });
  const live = page.getByRole('region', { name: 'Train status' });
  await expect(timetable.or(live)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/couldn.t get this train/i);
  await expect(page.locator('body')).not.toContainText(SOURCE_NAMES);
  expect(errors).toEqual([]);
});

test('an unknown train number gets a clear message', async ({ page }) => {
  await page.goto('/?train=99999');
  await expect(page.getByText(/don.t know a train numbered 99999/)).toBeVisible();
});
