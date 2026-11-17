import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '../test/utils';
import { ActionButton } from '../screens/ceo/_kit/actions';
import { RowMenu } from './RowMenu';
import { Button } from './Button';

/** 17 Nov, item 4: the per-person menus on Team & access — keyboard and screen-reader use. */
function Example({ lock, unlock }: { lock: () => Promise<unknown>; unlock: () => Promise<unknown> }) {
  return (
    <>
      <RowMenu label="Access" name="Deepa Nair">
        <ActionButton label="Unlock" title="Unlock Deepa Nair" run={unlock} success="Unlocked" />
        <Button disabled>Not now</Button>
        <ActionButton label="Lock" variant="danger" title="Lock Deepa Nair" description="They are signed out everywhere." run={lock} success="Locked" />
      </RowMenu>
      <button type="button">After</button>
    </>
  );
}

describe('RowMenu (menu button pattern)', () => {
  it('is a labelled menu button; the items are menu items, hidden until it opens', async () => {
    renderScreen(<Example lock={vi.fn()} unlock={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Access · Deepa Nair' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveClass('lb-menu__button');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Access · Deepa Nair' });
    expect(button).toHaveAttribute('aria-controls', menu.id);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Unlock', 'Not now', 'Lock']);
    for (const item of items) {
      expect(item).toHaveClass('lb-menu__item');
      expect(item).toHaveAttribute('tabindex', '-1');
    }
    expect(items[2]).toHaveClass('lb-menu__item--danger');
    expect(items[0]).toHaveFocus();
  });

  it('works from the keyboard: ↓ opens on the first item, arrows skip a disabled one and wrap, Escape returns to the button', async () => {
    renderScreen(<Example lock={vi.fn()} unlock={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Access · Deepa Nair' });
    button.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Unlock' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Lock' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Unlock' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Lock' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Unlock' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Lock' })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('an item opens its own dialog, which works as before; focus comes back to the menu button', async () => {
    const lock = vi.fn().mockResolvedValue({ ok: true });
    renderScreen(<Example lock={lock} unlock={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Access · Deepa Nair' });
    button.focus();
    await userEvent.keyboard('{End}');
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Lock' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Lock Deepa Nair' });
    expect(screen.queryByRole('menu')).toBeNull();
    // The dialog's buttons are ordinary buttons, not menu items.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('role');
    expect(within(dialog).getByText('They are signed out everywhere.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lock Deepa Nair' }));
    await waitFor(() => expect(lock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
  });

  it('a click outside closes it', async () => {
    renderScreen(<Example lock={vi.fn()} unlock={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Access · Deepa Nair' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'After' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
