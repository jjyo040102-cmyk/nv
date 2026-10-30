// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VerifiedContactsSettings } from "../../components/VerifiedContactsSettings";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("explains exact-address trust and unverified approval behavior",()=>{vi.stubGlobal("fetch",vi.fn(()=>new Promise(()=>{})));render(<VerifiedContactsSettings initialContacts={[]}/>);expect(screen.getByText(/주소가 한 글자라도 다르면/)).toBeTruthy();expect(screen.getByText(/승인 후 답장/)).toBeTruthy();expect(screen.queryByText(/도메인 전체/)).toBeNull();});
