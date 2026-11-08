export const NAME_CHECK_PROVIDER = Symbol('NAME_CHECK_PROVIDER');

export interface NameCheckResult {
  checked: boolean;
  message: string;
}

export interface NameCheckProvider {
  checkName(account: {
    method: string;
    upiId?: string;
    bankAccount?: string;
    ifsc?: string;
    ownerName?: string;
  }): Promise<NameCheckResult>;
}
