import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StaffAvatar, staffInitials } from './StaffAvatar';

describe('StaffAvatar', () => {
  it('shows the photo from its signed link', () => {
    render(<StaffAvatar name="Deepa Nair" photoUrl="https://photos.example/d.jpg" size="lg" />);
    const img = screen.getByTestId('staff-photo');
    expect(img).toHaveAttribute('src', 'https://photos.example/d.jpg');
    expect(img).toHaveClass('lb-staffphoto--lg');
  });

  it('falls back to initials with no photo, or when the link cannot be loaded', () => {
    const { rerender } = render(<StaffAvatar name="Deepa Nair" photoUrl={null} />);
    expect(screen.getByTestId('staff-initials')).toHaveTextContent('DN');
    rerender(<StaffAvatar name="Deepa Nair" photoUrl="https://photos.example/expired.jpg" />);
    fireEvent.error(screen.getByTestId('staff-photo'));
    expect(screen.getByTestId('staff-initials')).toHaveTextContent('DN');
    expect(staffInitials('ravi  shankar kumar')).toBe('RS');
  });
});
