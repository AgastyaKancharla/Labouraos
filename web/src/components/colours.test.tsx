import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderScreen, signInAs } from '../test/utils';
import { Ok, PageTitle, StepsBar } from '../screens/public/shared/ui';
import { Card } from './Card';
import { EmptyState } from './ErrorState';
import { FamilyContext } from './family';
import { TopBar } from './TopBar';

/*
 * Command Center colours on every screen (Master Guide rev 173): the shared
 * kit's coloured icon tiles, emoji pictures and gradient header cards. They
 * are decorative — the words carry the meaning — so headings and names read
 * exactly as before.
 */
describe('Command Center colours in the shared kit', () => {
  it('Card shows a coloured icon tile before the title without changing its name', () => {
    renderScreen(
      <FamilyContext.Provider value="portal">
        <Card title="Recent changes" icon="auditLog" tone="cyan">
          body
        </Card>
        <Card title="Plain card">body</Card>
      </FamilyContext.Provider>,
    );
    const heading = screen.getByRole('heading', { name: 'Recent changes' });
    const tile = heading.parentElement!.querySelector('.tile');
    expect(tile).toHaveClass('tile', 't-cyan');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    // A card without an icon stays exactly as it was.
    const plain = screen.getByRole('heading', { name: 'Plain card' });
    expect(plain.parentElement).toHaveClass('lb-card__head');
    expect(plain.parentElement!.querySelector('.tile')).toBeNull();
  });

  it('TopBar puts a coloured tile next to the page title only when asked', () => {
    signInAs('ceo');
    renderScreen(<TopBar title="Pricing & policy" icon="pricingAndPolicy" iconTone="gold" />, { portal: 'ceo', path: '/ceo/pricing' });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Pricing & policy' });
    const tile = h1.parentElement!.querySelector('.lb-topbar__tile');
    expect(tile).toHaveClass('t-gold');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
  });

  it('TopBar without an icon has no tile (the Command Center and matching screens are unchanged)', () => {
    signInAs('ceo');
    renderScreen(<TopBar title="Payments" />, { portal: 'ceo', path: '/ceo/payments' });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Payments' });
    expect(h1.parentElement!.querySelector('.tile')).toBeNull();
  });

  it('EmptyState shows its emoji as a picture hidden from screen readers', () => {
    renderScreen(<EmptyState emoji="📞" title="No incoming call." />);
    expect(screen.getByText('No incoming call.')).toBeInTheDocument();
    expect(screen.getByText('📞')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('public link pages: customer app look', () => {
  it('PageTitle is a blue gradient header card with the swoosh; the emoji is decorative', () => {
    renderScreen(<PageTitle emoji="🤝">Your permission</PageTitle>);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Your permission' });
    const card = h1.parentElement!;
    expect(card).toHaveClass('lb-pub-hero');
    expect(card.querySelector('.swoosh')).not.toBeNull();
    expect(screen.getByText('🤝')).toHaveAttribute('aria-hidden', 'true');
  });

  it('a status box can start with a friendly emoji that screen readers skip', () => {
    renderScreen(<Ok emoji="🎉">You are all set</Ok>);
    expect(screen.getByText('You are all set').closest('[role="status"]')).toHaveClass('ok', 'lb-pub-status');
    expect(screen.getByText('🎉')).toHaveAttribute('aria-hidden', 'true');
  });

  it('StepsBar colours each reached step and keeps the done / current markers', () => {
    const { container } = renderScreen(<StepsBar current={3} label="ID check" />);
    const segments = container.querySelectorAll('.lb-steps__bar span');
    expect(segments).toHaveLength(4);
    expect(segments[0]).toHaveClass('lb-steps__seg-1', 'done');
    expect(segments[1]).toHaveClass('lb-steps__seg-2', 'done');
    expect(segments[2]).toHaveClass('lb-steps__seg-3', 'on');
    expect(segments[3]).toHaveClass('lb-steps__seg-4');
    expect(segments[3]).not.toHaveClass('on');
    expect(segments[3]).not.toHaveClass('done');
  });
});
