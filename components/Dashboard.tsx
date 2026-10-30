"use client";
import { TaskDashboard } from "./TaskDashboard";
import type { LivingTaskRecord } from "@/lib/tasks/types";
import type { AppSettings, WorkflowListItem } from "./client";
export function Dashboard({initialTasks,initialWorkflows,initialSettings}:{initialTasks?:LivingTaskRecord[];initialWorkflows?:WorkflowListItem[];initialSettings?:AppSettings}){return <TaskDashboard initialTasks={initialTasks} initialWorkflows={initialWorkflows} initialSettings={initialSettings}/>;}
