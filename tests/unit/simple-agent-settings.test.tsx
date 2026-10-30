// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SimpleAgentSettings } from "../../components/SimpleAgentSettings";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows simple automation choices and recommends automation without recommending risky send",()=>{vi.stubGlobal("fetch",vi.fn(()=>new Promise(()=>{})));render(<SimpleAgentSettings initialSettings={{executionMode:"MANUAL",preExecutionEnabled:false,providerId:"demo",model:"actflow-demo-v1",effort:null,organizationPolicyVersion:1,automationProfile:"AUTOMATIC",autoContinueEnabled:true,projectMemoryEnabled:true,emailTaskDetectionEnabled:true,autoLinkWorkEnabled:true,replanOnNewInfoEnabled:true,retryFailedStepsEnabled:true,securityLevel:"HIGH"}}/>);expect(screen.getByText(/자동으로 처리/).textContent).toContain("추천");expect(screen.getByText(/자동 이어하기/)).toBeTruthy();expect(screen.getByText(/중요한 외부 작업/)).toBeTruthy();expect(screen.getByText(/확인 후 실행/).textContent).toContain("추천");expect(screen.queryByText(/Wake Engine|Policy Engine|Living Task|Exfiltration/i)).toBeNull();});
