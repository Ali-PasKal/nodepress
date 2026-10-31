import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, AlertTitle } from './alert.js';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { Skeleton } from './skeleton.js';

describe('Button', () => {
  it('defaults to type="button" so it never submits forms accidentally', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('respects an explicit type', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
  });

  it('renders its child element when asChild is set', () => {
    render(
      <Button asChild variant="outline">
        <a href="/admin/system/status">Status</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Status' });
    expect(link).toHaveAttribute('href', '/admin/system/status');
    expect(link.className).toContain('border-input');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('merges custom classes and lets them override variant utilities', () => {
    render(<Button className="h-12">Tall</Button>);
    const button = screen.getByRole('button', { name: 'Tall' });
    expect(button.className).toContain('h-12');
    expect(button.className).not.toContain('h-9');
  });
});

describe('Alert', () => {
  it('announces danger alerts assertively and others politely', () => {
    const { rerender } = render(
      <Alert tone="danger">
        <AlertTitle>Failed</AlertTitle>
      </Alert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    rerender(
      <Alert tone="info">
        <AlertTitle>Heads up</AlertTitle>
      </Alert>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Heads up');
  });
});

describe('Badge and Skeleton', () => {
  it('applies tone styles to badges', () => {
    render(<Badge tone="success">Operational</Badge>);
    expect(screen.getByText('Operational').className).toContain('text-success');
  });

  it('hides skeletons from assistive technology', () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
