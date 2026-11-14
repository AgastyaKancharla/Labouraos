export interface CreateReferralDto {
  name: string;
  phone?: string;
  mobileNumber?: string;
  type: 'individual' | 'business';
  whatsappPhone: string;
  language: 'kn' | 'hi' | 'en';
  individualRole?: 'auto_driver' | 'shop_staff' | 'shop_owner' | 'security_guard' | 'existing_worker' | 'other';
  businessId?: string;
  partnerBusinessType?: string;
  partnerBusinessName?: string;
  locality: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  heardFrom: 'toll_free_missed_call' | 'ad' | 'referral_partner' | 'field_visit' | 'social_media' | 'walk_in' | 'other' | 'laboura_app';
  otpRequestId: string;
  city?: string;
}
