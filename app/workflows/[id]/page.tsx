import { WorkflowWorkspace } from "@/components/WorkflowWorkspace";
export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) { return <WorkflowWorkspace id={(await params).id} />; }
