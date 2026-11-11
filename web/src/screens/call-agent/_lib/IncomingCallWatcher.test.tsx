import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen, signInAs } from '../../../test/utils';

function sseResponse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('Incoming call pop-up (live channel)', () => {
  it('pops up on any console screen when the server says a call is ringing, and opens the incoming-call card', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input), 'http://localhost');
        seen.push(`${url.pathname} ${(init.headers as Record<string, string>)?.Authorization ? 'auth' : 'none'}`);
        if (url.pathname === '/live/events') {
          return sseResponse(
            'event: ready\ndata: {"staffId":"staff-ca"}\n\n' +
              'event: incoming_call\nid: 1\ndata: {"callbackTaskId":"t1","known":true,"name":"Ramesh Gowda","code":"JS-00198","maskedPhone":"******4412"}\n\n',
          );
        }
        return new Response(JSON.stringify({ statusCode: 501 }), { status: 501 });
      }),
    );
    signInAs('call_agent');
    renderScreen(<div>Some screen</div>, { portal: 'call-agent', path: '/call-agent' });
    const popup = await screen.findByRole('alertdialog');
    expect(popup).toHaveTextContent('Incoming call · Ramesh Gowda');
    expect(popup).toHaveTextContent('JS-00198 · ******4412');
    expect(seen).toContain('/live/events auth');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByTestId('navigated-away')).toBeInTheDocument());
  });
});
