import { createInvoiceForProject } from "../invoices/createInvoice.js";
import { setProjectApproved } from "./approval.js";

export async function approveProject(
  projectId: string,
  clientToken: string,
): Promise<{ approved: boolean; invoiceId?: string }> {
  if (!clientToken) {
    throw new Error("Client token required");
  }

  await setProjectApproved(projectId, 5000);
  const invoice = await createInvoiceForProject(projectId);

  return { approved: true, invoiceId: invoice.id };
}
