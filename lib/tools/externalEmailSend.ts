import { z } from 'zod';
import { getMailTransport } from '../email/transport-registry';
import { sendGuardedDraft } from '../email/outbox';
import type { ToolDefinition } from './types';
const Args=z.object({recipient:z.string().min(3).max(254),subject:z.string().max(500),body:z.string().max(20000),threadId:z.string().nullable(),livingTaskId:z.string().min(1)}).strict();
export const externalEmailSendTool:ToolDefinition={name:'external.email.send',version:'2',minimumPolicy:'AUTO',externalSideEffect:true,reversible:false,
  async execute(args,ctx){
    const input=Args.parse(args);if(!ctx.db)throw new Error('Authoritative database boundary is required');
    const transport=getMailTransport(ctx.db);
    const result=await sendGuardedDraft(ctx.db,ctx.workflowId,ctx.nodeId,input,transport,ctx.dataDir);
    return {ok:result.ok,sent:result.sent,filesCreated:[],dataRead:[],fieldsRead:[],fieldsExcluded:[],externalSideEffect:result.externalEffect==='ACTUAL',externalEffect:result.externalEffect,reversible:false,evidence:{messageId:result.messageId,recipient:input.recipient,transport:transport.name}};
  }
};
