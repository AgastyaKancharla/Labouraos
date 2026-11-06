import { Response } from 'express';
import { CandidateIntroductionController } from './candidate-introduction.controller';
import { CandidateIntroductionService } from './candidate-introduction.service';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';

describe('CandidateIntroductionController', () => {
  it('exposes no edit or delete route for immutable introduction records', () => {
    const methods = Object.getOwnPropertyNames(CandidateIntroductionController.prototype)
      .map((name) => Object.getOwnPropertyDescriptor(CandidateIntroductionController.prototype, name)?.value)
      .filter((handler): handler is (...args: never[]) => unknown => typeof handler === 'function')
      .map((handler) => Reflect.getMetadata(METHOD_METADATA, handler));
    expect(methods).toEqual([undefined, RequestMethod.GET]);
  });

  it('renders only the candidate card fields on the public share page', async () => {
    const service = {
      redeemShareLink: jest.fn().mockResolvedValue({
        cards: [{
          firstName: 'Asha',
          photoUrl: 'https://storage.example/signed-photo',
          photoUrlExpiresInSeconds: 300,
          age: 25,
          trade: 'Electrician',
          yearsExperience: 4,
          languages: ['Kannada'],
          distanceKm: 3,
          expectedSalary: { minPaise: 1500000, maxPaise: 1800000 },
          matchReasons: ['Electrician, 4 yrs', '3 km away'],
          phone: '+919999999999',
          lastName: 'Private',
          address: 'Private address',
          dateOfBirth: '2001-01-01',
          aadhaarNumber: '123456789012',
        }],
      }),
    };
    const response = { setHeader: jest.fn() } as unknown as Response;
    const controller = new CandidateIntroductionController(service as unknown as CandidateIntroductionService);

    const html = await controller.redeem('token', 'text/html', response) as string;

    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(html).toContain('Asha, 25');
    expect(html).toContain('Electrician, 4 years');
    expect(html).not.toMatch(/9999999999|Private|2001-01-01|123456789012/);
  });
});
