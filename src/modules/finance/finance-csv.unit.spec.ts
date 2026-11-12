import { csvCell, rupees, toCsv } from './finance-csv';
import { invoiceGstSplit } from '../placement/invoice-gst-split';

describe('CSV files for the CA', () => {
  it('keeps negative and plain numbers as numbers', () => {
    expect(csvCell('-8000.00')).toBe('-8000.00');
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell(rupees(-144000))).toBe('-1440.00');
  });

  it('still writes anything formula-like as text', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('+91 98765')).toBe("'+91 98765");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('quotes commas and quotes', () => {
    expect(toCsv(['a'], [['x, "y"']])).toBe('a\n"x, ""y"""\n');
  });
});

describe('GST split on an invoice', () => {
  it('is half CGST and half SGST, CGST rounded down, no IGST', () => {
    expect(invoiceGstSplit(144001, 18)).toEqual({ cgstRatePercent: 9, sgstRatePercent: 9, cgstAmountPaise: 72000, sgstAmountPaise: 72001, igstRatePercent: 0, igstAmountPaise: 0 });
  });
});
