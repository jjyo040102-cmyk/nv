import type Database from "better-sqlite3";
import { DemoMailTransport } from "./demo-transport";
import type { MailTransport } from "./types";

const defaultTransport = new DemoMailTransport();
const transports=new WeakMap<Database.Database,MailTransport>();
let activeTransport: MailTransport = defaultTransport;

export function getMailTransport(db?:Database.Database): MailTransport { if(db){const transport=transports.get(db);if(!transport)throw new Error("No mail adapter registered for this database");return transport;}return activeTransport; }
export function setMailTransport(transport: MailTransport,db?:Database.Database): void { if(db)transports.set(db,transport);else activeTransport = transport; }
export function resetMailTransport(): void { activeTransport = defaultTransport; }
