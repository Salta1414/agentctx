let counter = 1000;

export async function generateInvoiceNumber(): Promise<string> {
  counter += 1;
  return `INV-${counter}`;
}
