import type { TriggerType, WakeEventRecord } from "../tasks/types";
export type AddTriggerInput={id?:string;ownerSessionId:string;livingTaskId:string;type:TriggerType;configJson:Record<string,unknown>;enabled?:boolean;nextDueAt?:string|null};
export type RecordWakeEventInput={id?:string;triggerId:string;ownerSessionId:string;eventKey:string;type:TriggerType;payloadJson:Record<string,unknown>};
export type RecordWakeEventResult={event:WakeEventRecord;duplicate:boolean};
export type WakeInput={triggerId:string;ownerSessionId:string;eventKey:string;type:TriggerType;payloadJson:Record<string,unknown>};
export type WakeResult={event:WakeEventRecord;duplicate:boolean;woke:boolean;reason?:string};
