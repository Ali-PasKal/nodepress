import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, THEME_STORAGE_KEY, useThemeStore } from '../stores/theme-store';
import { ThemeSync } from './theme-sync';
import { ThemeToggle } from './theme-toggle';

describe('theme', () => {
  beforeEach(() => {
    act(() => {
      useThemeStore.setState({ preference: 'system' });
    });
  });

  it('resolves the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('applies the chosen theme to <html> and persists the preference', async () => {
    render(
      <>
        <ThemeSync />
        <ThemeToggle />
      </>,
    );
    expect(document.documentElement).not.toHaveClass('dark');

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? '{}')).toMatchObject({
      state: { preference: 'dark' },
    });

    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('exposes the control as a labelled radio group', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
