import { z } from "zod";

const ConfigSchema = z.object({
  ACTFLOW_DATA_DIR: z.string().min(1).default("./data/runtime"),
  ACTFLOW_DB_PATH: z.string().min(1).default("./data/runtime/actflow.sqlite"),
  ACTFLOW_DEMO_AUTH: z.enum(["true", "false"]).default("true"),
  ACTFLOW_MAX_UPLOAD_MB: z.coerce.number().int().positive().max(100).default(25),
  ACTFLOW_MASTER_KEY: z.string().optional()
});

export interface AppConfig {
  dataDir: string;
  dbPath: string;
  demoAuth: boolean;
  maxUploadMb: number;
  masterKey?: string;
}

export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const values = ConfigSchema.parse(env);
  return {
    dataDir: values.ACTFLOW_DATA_DIR,
    dbPath: values.ACTFLOW_DB_PATH,
    demoAuth: values.ACTFLOW_DEMO_AUTH === "true",
    maxUploadMb: values.ACTFLOW_MAX_UPLOAD_MB,
    masterKey: values.ACTFLOW_MASTER_KEY || undefined
  };
}
