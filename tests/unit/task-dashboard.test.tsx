// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LivingTaskRecord } from "../../lib/tasks/types";
import { TaskDashboard } from "../../components/TaskDashboard";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function task(id: string, status: LivingTaskRecord["status"], overrides: Partial<LivingTaskRecord> = {}): LivingTaskRecord {
  return {
    id, ownerSessionId: "s", projectId: null, title: `작업 ${id}`, goal: `목표 ${id}`, status,
    executionMode: "MANUAL", backgroundWatchEnabled: false, speculativePreparationEnabled: false,
    currentWorkflowId: null, agentSessionId: null, nextActionSummary: null, waitingReason: null,
    version: 0, createdAt: "2026-10-23T04:00:00.000Z", updatedAt: "2026-10-23T04:00:00.000Z", completedAt: null,
    ...overrides
  };
}
function jsonResponse(data: unknown, ok = true) { return { ok, json: async () => data }; }

describe("task overview", () => {
  it("prioritizes tasks needing attention and filters the actual records", async () => {
    const user = userEvent.setup();
    render(<TaskDashboard initialTasks={[
      task("active", "RUNNING", { title: "명단 작성", updatedAt: "2026-10-23T06:00:00.000Z" }),
      task("waiting", "WAITING_EVENT", { waitingReason: "새 답장 대기" }),
      task("approval", "WAITING_APPROVAL", { title: "출장비 검토", waitingReason: "사용자 승인 대기" }),
      task("done", "COMPLETED", { nextActionSummary: "오래된 다음 단계" })
    ]} initialWorkflows={[]} />);
    const region = screen.getByRole("region", { name: /내 작업/ });
    expect(within(region).getAllByRole("link")[0].getAttribute("href")).toBe("/tasks/approval");
    expect(screen.getByRole("button", { name: "진행 1" })).toBeTruthy();
    expect(screen.getByText("새 답장 대기")).toBeTruthy();
    expect(screen.getByText("결과와 완료 근거를 확인하세요.")).toBeTruthy();
    expect(screen.queryByText("오래된 다음 단계")).toBeNull();

    await user.click(screen.getByRole("button", { name: "확인 필요 1" }));
    expect(screen.getByRole("button", { name: "확인 필요 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
    expect(within(region).getByRole("link").getAttribute("href")).toBe("/tasks/approval");
    expect(screen.getByText("1개 표시 · 전체 4개")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "전체 4" }));
    await user.type(screen.getByRole("searchbox", { name: "작업 검색" }), "명단");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
    expect(within(region).getByRole("link").getAttribute("href")).toBe("/tasks/active");
    await user.type(screen.getByRole("searchbox"), "없는 검색어");
    expect(screen.getByText("검색한 작업을 찾지 못했어요.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "전체 작업 보기" }));
    expect(within(region).getAllByRole("link")).toHaveLength(4);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("keeps the empty state actionable with keyboard focus", async () => {
    render(<TaskDashboard initialTasks={[]} initialWorkflows={[]} />);
    expect(screen.queryByRole("group", { name: "작업 상태 필터" })).toBeNull();
    expect((screen.getByRole("button", { name: "시작" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "목표 입력하기" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "새 업무 목표" }));
  });

  it("shows a retryable load error instead of claiming an empty workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "연결을 다시 확인해 주세요." } }, false));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDashboard />);
    expect(screen.getByRole("status").textContent).toContain("작업을 불러오고 있습니다.");
    await screen.findByRole("alert");
    expect(screen.queryByText("첫 작업을 위한 공간이 준비됐어요.")).toBeNull();
    fetchMock.mockImplementation((url: string) => Promise.resolve(jsonResponse(url === "/api/tasks" ? { tasks: [task("restored", "RUNNING")] } : { workflows: [] })));
    await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await screen.findByText("작업 restored");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("supported document sample", () => {
  it("fills the editable goal and real document without executing until Start", async () => {
    const sample = "교육 운영팀 발신\n참가자 명단과 회신 문서를 준비하세요.";
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/demo") return { ok: true, text: async () => sample };
      if (url === "/api/workflows") return jsonResponse({ workflow: { id: "source-workflow" } });
      if (url === "/api/tasks") return jsonResponse({ task: task("new-task", "READY") });
      if (url === "/api/tasks/new-task/execute") return jsonResponse({ task: task("new-task", "RUNNING") });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskDashboard initialTasks={[]} initialWorkflows={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "예제 문서로 시작" }));
    await screen.findByText("training-notice.txt");
    expect((screen.getByRole("textbox", { name: "새 업무 목표" }) as HTMLTextAreaElement).value).toContain("참가자 명단과 회신 문서");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tasks/new-task"));
    const requests = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const upload = requests.find(([url]) => url === "/api/workflows")!;
    const file = (upload[1].body as FormData).get("file") as File;
    expect(file.name).toBe("training-notice.txt");
    expect(file.type).toBe("text/plain");
    const content = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(file); });
    expect(content).toBe(sample);
    const create = requests.find(([url]) => url === "/api/tasks")!;
    expect(JSON.parse(create[1].body as string)).toMatchObject({ sourceWorkflowId: "source-workflow", goal: expect.stringContaining("내 확인을 받아줘") });
    expect(requests.filter(([url]) => url === "/api/tasks/new-task/execute")).toHaveLength(1);
  });

  it("preserves the current draft if loading a sample fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<TaskDashboard initialTasks={[]} initialWorkflows={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "새 업무 목표" }), "내가 작성한 목표");
    await userEvent.click(screen.getByRole("button", { name: "입력 내용을 예제로 바꾸기" }));
    expect((await screen.findByRole("alert")).textContent).toContain("예제 문서를 불러오지 못했습니다.");
    expect((screen.getByRole("textbox", { name: "새 업무 목표" }) as HTMLTextAreaElement).value).toBe("내가 작성한 목표");
    expect(screen.queryByText("training-notice.txt")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
