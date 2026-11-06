import { BusinessController } from './business.controller';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';

describe('Business introductions access', () => {
  it('restricts introduction history to Team Leads and management', () => {
    const descriptor = Object.getOwnPropertyDescriptor(BusinessController.prototype, 'listIntroductions');
    expect(descriptor).toBeDefined();
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, descriptor!.value)).toEqual(['team_lead', 'manager', 'ceo']);
  });
});
