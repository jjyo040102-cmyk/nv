"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, GitBranch, LayoutDashboard, Settings2, ShieldCheck, SquareCheckBig } from "lucide-react";
import { DemoActorSelector } from "./DemoActorSelector";

const navigation = [
  { href: "/", label: "작업", icon: LayoutDashboard },
  { href: "/approvals", label: "승인함", icon: SquareCheckBig },
  { href: "/settings", label: "설정", icon: Settings2 }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login" || path === "/privacy") return <>{children}</>;
  const pageName = path === "/settings" ? "설정" : path === "/policies" ? "조직 정책" : path === "/approvals" ? "승인함" : path === "/recorder" ? "실행 기록" : path.startsWith("/workflows") ? "문서 작업" : path.startsWith("/tasks") ? "작업 상세" : "작업 개요";
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="ActFlow 홈"><span className="brand-mark"><GitBranch size={23} aria-hidden="true" /></span><span>ActFlow<span className="brand-ai">AI</span></span></Link>
      <div className="sidebar-workspace"><span className="workspace-monogram">W</span><div><strong>나의 워크스페이스</strong><small>실행을 이어가는 공간</small></div></div>
      <p className="nav-caption">WORKSPACE</p>
      <nav aria-label="주 메뉴">{navigation.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" || path.startsWith("/workflows") || path.startsWith("/tasks") : path.startsWith(href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`nav-link ${active ? "active" : ""}`}><Icon size={19} aria-hidden="true" />{label}{active && <span className="nav-active-dot" />}</Link>;
      })}</nav>
      <div className="sidebar-bottom"><div className="sidebar-principle"><ShieldCheck size={21} aria-hidden="true" /><strong>중요한 결정은<br />당신의 손에.</strong><p>승인할 내용과 실행한 결과를<br />언제든 확인하세요.</p><Link href="/approvals">승인함 열기 <ArrowUpRight size={13} aria-hidden="true" /></Link></div><p className="brand-promise">FROM INTENT TO DONE</p></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><span className="breadcrumb">워크스페이스</span><span className="breadcrumb-divider">/</span><strong>{pageName}</strong></div><div className="topbar-right"><span className="product-edition">ACTFLOW <span>AI WORKSPACE</span></span><DemoActorSelector /></div></header><main id="main-content" tabIndex={-1} className="main-content">{children}</main></div>
  </div>;
}
