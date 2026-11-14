import { InterviewController } from '../vacancy/interview.controller';

describe('Phase 15 Task 6 screens', () => {
  it('opens the new offer page (P03) in a browser and gives API clients only the offer details', async () => {
    process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.laboura.in';
    const details = { firstName: 'Ramesh', job: 'Electrician', area: 'HSR Layout' };
    const controller = new InterviewController({
      candidateReplyDetails: jest.fn().mockResolvedValue(details),
    } as never);
    const redirect = jest.fn();
    await controller.replyPage('single-use-token', 'text/html', { redirect } as never);
    expect(redirect).toHaveBeenCalledWith(302, expect.stringMatching(/\/\/[^/]+\/p\/offer\/single-use-token$/));
    const json = await controller.replyPage('single-use-token', 'application/json', { redirect: jest.fn() } as never);
    expect(json).toEqual(details);
    expect(JSON.stringify(json)).not.toContain('businessName');
    expect(JSON.stringify(json)).not.toContain('address');
  });
});
