import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '../test/utils';
import { StatusPill } from './Badge';
import { Button } from './Button';
import { FamilyContext } from './family';
import { Modal } from './Modal';
import { StatTile } from './StatTile';
import { Tabs } from './Tabs';
import { ToastProvider, useToast } from './Toast';

describe('Modal', () => {
  function Harness({ onClose = () => {} }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Modal
          open={open}
          title="Release refund"
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          footer={<Button>Confirm</Button>}
        >
          <input aria-label="Reason" />
        </Modal>
      </>
    );
  }

  it('moves focus in, traps Tab, closes on Escape and returns focus', async () => {
    const onClose = vi.fn();
    renderScreen(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Release refund' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('Tabs', () => {
  it('moves with arrow keys and keeps only the active tab in the Tab order', async () => {
    function Harness() {
      const [v, setV] = useState<'in' | 'out' | 'gst'>('in');
      return (
        <Tabs
          label="Payments"
          value={v}
          onChange={setV}
          items={[
            { key: 'in', label: 'Money in' },
            { key: 'out', label: 'Money out' },
            { key: 'gst', label: 'GST & invoices', count: 3 },
          ]}
        >
          <p>Panel {v}</p>
        </Tabs>
      );
    }
    renderScreen(<Harness />);
    const first = screen.getByRole('tab', { name: 'Money in' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Money out' })).toHaveAttribute('tabindex', '-1');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Money out' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel out');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /GST/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
  });
});

describe('Toast', () => {
  it('shows a message in a live region and closes it', async () => {
    function Harness() {
      const toast = useToast();
      return <button onClick={() => toast.success('Approved. An SMS was sent.')}>Approve</button>;
    }
    renderScreen(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const msg = screen.getAllByText('Approved. An SMS was sent.')[0];
    expect(msg.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.queryAllByText('Approved. An SMS was sent.')).toHaveLength(0);
  });
});

describe('family-aware components', () => {
  it('renders the portal or console look', () => {
    renderScreen(
      <>
        <FamilyContext.Provider value="portal">
          <Button variant="primary">Portal</Button>
          <StatusPill tone="crit">Act</StatusPill>
        </FamilyContext.Provider>
        <FamilyContext.Provider value="console">
          <Button variant="primary">Console</Button>
          <StatusPill tone="crit">Day 27 of 30</StatusPill>
        </FamilyContext.Provider>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Portal' })).toHaveClass('btn2', 'p');
    expect(screen.getByRole('button', { name: 'Console' })).toHaveClass('btn', 'bp');
    expect(screen.getByText('Act')).toHaveClass('pill', 'crit');
    expect(screen.getByText('Day 27 of 30')).toHaveClass('tag', 'tr');
  });

  it('marks a loading button busy and disabled', () => {
    renderScreen(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });

  it('StatTile links to the list behind the number', () => {
    renderScreen(<StatTile label="Unmatched bank credits" value="3" tone="gold" to="/finance/money-in" />);
    expect(screen.getByRole('link', { name: /Unmatched bank credits/ })).toHaveAttribute('href', '/finance/money-in');
  });
});
