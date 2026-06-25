import { approveProject } from "../../features/projects/approveProject.js";

export async function handleApproveProject(
  projectId: string,
  clientToken: string,
) {
  return approveProject(projectId, clientToken);
}
