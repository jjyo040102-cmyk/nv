// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { ProviderSettings } from "../../components/ProviderSettings";
import { listProviderPresets } from "../../lib/providers/presets";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const value = { presets: listProviderPresets(), selected: { executionMode: "MANUAL" as const, preExecutionEnabled: false, providerId: "nebius" as const, model: "nvidia/nemotron-3-super-120b-a12b", effort: null, organizationPolicyVersion: 1 }, credentials: [] };

describe("Nebius settings", () => {
  it("ignores a stale initial response after Strict Mode remount", async () => {
    const pending: ((value: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
    render(<StrictMode><ProviderSettings/></StrictMode>);
    expect(pending).toHaveLength(2);
    await act(async () => pending[1](new Response(JSON.stringify(value))));
    await userEvent.selectOptions(screen.getByLabelText("NVIDIA 분석 모델"), "custom");
    await userEvent.clear(screen.getByLabelText("NVIDIA 모델 ID"));
    await userEvent.type(screen.getByLabelText("NVIDIA 모델 ID"), "nvidia/custom-model");
    await act(async () => pending[0](new Response(JSON.stringify(value))));
    expect((screen.getByLabelText("NVIDIA 모델 ID") as HTMLInputElement).value).toBe("nvidia/custom-model");
  });
  it("prevents changing model or saving before settings load", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ProviderSettings/>);
    expect((screen.getByLabelText("NVIDIA 분석 모델") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "설정 저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /OpenAI|Anthropic|Gemini|로컬 Qwen/ })).toBeNull();
  });
  it("shows masked credentials and requires deliberate deletion", async () => {
    render(<ProviderSettings initialData={{ ...value, credentials: [{ provider: "nebius", saved: true, storage: "memory", maskedHint: "••••6789" }] }}/>);
    expect(screen.getByText(/••••6789/)).toBeTruthy();
    expect((screen.getByLabelText("API 키") as HTMLInputElement).type).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: /연결 해제/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
