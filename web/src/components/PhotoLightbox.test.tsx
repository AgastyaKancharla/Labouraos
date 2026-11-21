import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderScreen } from '../test/utils';
import { ZoomablePhoto } from './PhotoLightbox';

describe('ID photo large view (22 Nov)', () => {
  it('opens large on click, zooms with the buttons, the keys and the wheel, and closes with Esc and the Close button', async () => {
    renderScreen(<ZoomablePhoto src="https://signed/card.jpg" alt="Photo of the PAN card of Anthony" />);
    const thumb = screen.getByRole('button', { name: 'Open large: Photo of the PAN card of Anthony' });
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();
    await userEvent.click(thumb);
    const box = screen.getByRole('dialog', { name: 'Photo of the PAN card of Anthony' });
    const big = within(box).getByRole('img', { name: 'Photo of the PAN card of Anthony' });
    expect(big).toHaveAttribute('src', 'https://signed/card.jpg');
    // Focus is on Close, so a keyboard user can leave at once.
    expect(within(box).getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(within(box).getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    await userEvent.click(within(box).getByRole('button', { name: 'Zoom in' }));
    expect(within(box).getByRole('button', { name: 'Actual size' })).toHaveTextContent('150%');
    expect(big.style.transform).toContain('scale(1.5)');
    await userEvent.keyboard('+');
    expect(within(box).getByRole('button', { name: 'Actual size' })).toHaveTextContent('225%');
    await userEvent.keyboard('0');
    expect(within(box).getByRole('button', { name: 'Actual size' })).toHaveTextContent('100%');
    fireEvent.wheel(big, { deltaY: -100 });
    expect(within(box).getByRole('button', { name: 'Actual size' })).toHaveTextContent('115%');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();
    expect(thumb).toHaveFocus();
    await userEvent.click(thumb);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();
  });

  it('a link that no longer loads says so instead of a broken picture', async () => {
    renderScreen(<ZoomablePhoto src="https://signed/old.jpg" alt="Live selfie" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open large: Live selfie' }));
    const box = screen.getByTestId('photo-lightbox');
    fireEvent.error(within(box).getByRole('img', { name: 'Live selfie' }));
    expect(within(box).getByRole('alert')).toHaveTextContent(/open the photos again/);
  });
});
