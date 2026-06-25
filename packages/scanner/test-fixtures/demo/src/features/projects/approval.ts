export interface ApprovalStatus {
  approved: boolean;
  approvedAmount: number;
  approvedAt?: string;
}

const approvals = new Map<string, ApprovalStatus>();

export async function getProjectApprovalStatus(
  projectId: string,
): Promise<ApprovalStatus> {
  return (
    approvals.get(projectId) ?? {
      approved: false,
      approvedAmount: 0,
    }
  );
}

export async function setProjectApproved(
  projectId: string,
  amount: number,
): Promise<void> {
  approvals.set(projectId, {
    approved: true,
    approvedAmount: amount,
    approvedAt: new Date().toISOString(),
  });
}
