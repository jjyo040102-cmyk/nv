import { z } from "zod";
import type { ToolDefinition } from "./types";
import { fixtureModelEnabled } from '../providers/presets';

const Args = z.object({ recipient: z.string().min(1) });
export const demoEmailSimulationTool: ToolDefinition = {
  name: "demo.email.simulate", version: "1", minimumPolicy: "CONFIRM", externalSideEffect: false, reversible: true,
  async execute(args) {
    if (!fixtureModelEnabled()) throw new Error('Email simulation is available only in development test mode.');
    const { recipient } = Args.parse(args);
    return { ok: true, sent: false, filesCreated: [], dataRead: [], fieldsRead: [], fieldsExcluded: [],
      externalSideEffect: false, reversible: true,
      evidence: { simulation: true, recipient, sent: false, externalEffect: "NONE", message: "데모 시뮬레이션입니다. 실제 이메일은 발송되지 않았습니다." } };
  }
};
