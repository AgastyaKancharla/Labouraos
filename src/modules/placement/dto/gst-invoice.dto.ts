export interface InvoiceSupplier {
  legalName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
}

export interface InvoiceCustomer {
  businessId: string;
  businessCode: string;
  businessName: string;
  contactName: string | null;
  contactPhone?: string;
  gstin: string | null;
  address: string | null;
  area: string;
  city: string;
  state: string;
  stateCode: string;
}

export interface InvoicePlacementInfo {
  placementId: string;
  placementCode: string;
  candidateCode: string;
  candidateName: string;
  candidatePhone?: string;
  tradeSkill: string;
  monthlySalaryPaise: number;
  joinedDate: string | null;
}

export interface InvoiceLineItem {
  itemNumber: number;
  description: string;
  sacCode: string;
  baseAmountPaise: number;
  taxRatePercent: number;
  cgstRatePercent: number;
  cgstAmountPaise: number;
  sgstRatePercent: number;
  sgstAmountPaise: number;
  igstRatePercent: number;
  igstAmountPaise: number;
  totalAmountPaise: number;
}

export interface InvoiceSummary {
  subtotalPaise: number;
  totalTaxPaise: number;
  totalAmountPaise: number;
  currency: string;
  amountInWords: string;
}

export interface GstInvoiceResponse {
  invoiceNumber: string;
  invoiceDate: string;
  supplier: InvoiceSupplier;
  customer: InvoiceCustomer;
  placement: InvoicePlacementInfo;
  lineItems: InvoiceLineItem[];
  summary: InvoiceSummary;
}
