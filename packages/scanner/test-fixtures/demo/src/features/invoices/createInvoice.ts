import { generateInvoiceNumber } from "./generateInvoiceNumber.js";
import { getProjectApprovalStatus } from "../projects/approval.js";

export interface Invoice {
  id: string;
  projectId: string;
  number: string;
  amount: number;
}

export async function createInvoiceForProject(
  projectId: string,
): Promise<Invoice> {
  const status = await getProjectApprovalStatus(projectId);

  if (!status.approved) {
    throw new Error("Cannot create invoice before client approval");
  }

  const number = await generateInvoiceNumber();

  return {
    id: crypto.randomUUID(),
    projectId,
    number,
    amount: status.approvedAmount,
  };
}
