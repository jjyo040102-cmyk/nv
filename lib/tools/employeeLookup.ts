import { z } from "zod";
import employeeData from "../../data/demo/employees.json";
import type { ParticipantRow } from "../artifacts/xlsxGenerator";
import type { ToolDefinition, ToolResult } from "./types";

const Args = z.object({ eligibleOnly: z.boolean().default(true) });
const fieldsRead = ["id", "name", "department", "title", "eligibleForTraining"];
const fieldsExcluded = ["bankAccount", "personalPhone", "residentRegistrationLikeDummy"];

export async function lookupEmployees(args: unknown): Promise<ToolResult> {
  const { eligibleOnly } = Args.parse(args);
  const employees: ParticipantRow[] = employeeData
    .filter(employee => !eligibleOnly || employee.eligibleForTraining)
    .map(employee => ({ id: employee.id, name: employee.name, department: employee.department, title: employee.title, eligibleForTraining: employee.eligibleForTraining }));
  return { ok: true, data: employees, filesCreated: [], dataRead: ["demo/employees"], fieldsRead, fieldsExcluded,
    externalSideEffect: false, reversible: true, evidence: { resultCount: employees.length, projection: fieldsRead } };
}

export const employeeLookupTool: ToolDefinition = {
  name: "employee.lookup", version: "1", minimumPolicy: "AUTO", externalSideEffect: false, reversible: true,
  execute: async args => lookupEmployees(args)
};
